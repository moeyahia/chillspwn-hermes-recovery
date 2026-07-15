#!/usr/bin/env python3
"""Root-owned, narrowly scoped broker for ChillsPwn reusable memory.

The dashboard/gateway service account deliberately has no filesystem write
permission beneath ``$HERMES_HOME/memories``. It can connect to this Unix socket
and request only:

* ``add`` -- validated, additive, backup-before-write persistence;
* ``safe-read`` -- policy-filtered prompt context.

The broker never accepts arbitrary commands, paths outside the memory root,
replace/remove/restore operations, or client-selected executable paths. It runs
the root-owned ``chillspwn_mem.py`` helper with entry content on stdin. Curator
operations remain an explicit root/operator workflow outside this service.
"""

from __future__ import annotations

import grp
import json
import os
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any


MAX_REQUEST_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
DEFAULT_SOCKET = "/run/chillspwn-memory/broker.sock"
DEFAULT_CLI = (
    "/root/.hermes/skills/red-teaming/council-of-ais/scripts/chillspwn_mem.py"
)


def _safe_error(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


def _trusted_executable(path_value: str, label: str) -> str:
    """Resolve a root-owned executable/script that is not group/world writable."""
    if not path_value or not os.path.isabs(path_value):
        raise RuntimeError(f"{label} must be configured as an absolute path")
    configured = Path(path_value)
    try:
        resolved = configured.resolve(strict=True)
        info = resolved.stat()
    except OSError as exc:
        raise RuntimeError(f"{label} is unavailable") from exc
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"{label} is not a regular file")
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError(f"{label} must be root-owned and not group/world writable")
    if label == "Python" and not os.access(resolved, os.X_OK):
        raise RuntimeError("Python is not executable")
    return str(resolved)


def _peer_uid(request: socket.socket) -> int:
    if not hasattr(socket, "SO_PEERCRED"):
        raise RuntimeError("SO_PEERCRED is required")
    raw = request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", raw)
    return int(uid)


class MemoryBroker:
    def __init__(self) -> None:
        self.python = _trusted_executable(
            os.environ.get("HERMES_PYTHON", "") or sys.executable,
            "Python",
        )
        self.cli = _trusted_executable(
            os.environ.get("CHILLSPWN_MEM_CLI", "") or DEFAULT_CLI,
            "validated memory helper",
        )

    def _run(self, args: list[str], content: str = "") -> dict[str, Any]:
        env = os.environ.copy()
        env["CHILLSPWN_MEMORY_BROKER_INTERNAL"] = "1"
        try:
            completed = subprocess.run(
                [self.python, self.cli, *args],
                input=content,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
                env=env,
            )
        except (OSError, subprocess.SubprocessError):
            return _safe_error("validated memory operation failed")
        try:
            result = json.loads((completed.stdout or "").strip())
        except (TypeError, json.JSONDecodeError):
            return _safe_error("validated memory operation returned an invalid response")
        if not isinstance(result, dict):
            return _safe_error("validated memory operation returned an invalid response")
        # The helper's response contains only sanitized detail/category labels.
        # Never return stderr or command diagnostics to the caller.
        if completed.returncode != 0:
            result["ok"] = False
        return result

    def dispatch(self, peer_uid: int, request: Any) -> dict[str, Any]:
        if not isinstance(request, dict):
            return _safe_error("request must be a JSON object")
        action = request.get("action")
        target = request.get("target")
        if action not in {"add", "safe-read"}:
            return _safe_error("broker permits only add and safe-read")
        if target not in {"memory", "user"}:
            return _safe_error("target must be memory or user")

        if action == "add":
            content = request.get("content")
            if not isinstance(content, str) or not content.strip():
                return _safe_error("content is required")
            if len(content.encode("utf-8", errors="replace")) > MAX_REQUEST_BYTES:
                return _safe_error("content exceeds broker limit")
            return self._run(
                [
                    "add",
                    "--target",
                    target,
                    "--stdin",
                    "--actor",
                    f"memory-broker-uid-{peer_uid}",
                ],
                content,
            )

        args = ["safe-read", "--target", target, "--format", "json"]
        requested_path = request.get("path")
        if requested_path is not None:
            if not isinstance(requested_path, str) or not requested_path:
                return _safe_error("path must be a non-empty string")
            args.extend(["--path", requested_path])
        return self._run(args)


class BrokerHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        try:
            peer_uid = _peer_uid(self.request)
            raw = self.rfile.readline(MAX_REQUEST_BYTES + 1)
            if not raw or len(raw) > MAX_REQUEST_BYTES or not raw.endswith(b"\n"):
                response = _safe_error("invalid or oversized broker request")
            else:
                try:
                    request = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    response = _safe_error("invalid broker JSON")
                else:
                    response = self.server.broker.dispatch(peer_uid, request)
        except Exception:
            response = _safe_error("memory broker request failed")
        encoded = (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8")
        if len(encoded) > MAX_RESPONSE_BYTES:
            encoded = (json.dumps(_safe_error("broker response exceeds limit")) + "\n").encode()
        self.wfile.write(encoded)


class BrokerServer(socketserver.ThreadingUnixStreamServer):
    allow_reuse_address = False
    daemon_threads = True

    def __init__(self, socket_path: str, broker: MemoryBroker):
        self.broker = broker
        super().__init__(socket_path, BrokerHandler)


def _prepare_socket(path: Path) -> int:
    if not path.is_absolute():
        raise RuntimeError("CHILLSPWN_MEMORY_SOCKET must be absolute")
    path.parent.mkdir(parents=True, exist_ok=True)
    group = grp.getgrnam(os.environ.get("CHILLSPWN_SERVICE_GROUP", "chillspwn"))
    os.chown(path.parent, 0, group.gr_gid)
    os.chmod(path.parent, 0o750)
    if os.path.lexists(path):
        info = path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0:
            raise RuntimeError("refusing unsafe pre-existing broker socket path")
        path.unlink()
    return group.gr_gid


def main() -> int:
    if os.geteuid() != 0:
        raise RuntimeError("memory broker must run as root")
    socket_path = Path(
        os.environ.get("CHILLSPWN_MEMORY_SOCKET", "") or DEFAULT_SOCKET
    )
    group_id = _prepare_socket(socket_path)
    broker = MemoryBroker()
    old_umask = os.umask(0o117)
    try:
        server = BrokerServer(str(socket_path), broker)
    finally:
        os.umask(old_umask)
    os.chown(socket_path, 0, group_id)
    os.chmod(socket_path, 0o660)

    def stop(_signum: int, _frame: Any) -> None:
        # shutdown() must run outside the serve_forever thread.
        import threading

        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        try:
            socket_path.unlink()
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
