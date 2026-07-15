#!/usr/bin/env python3
"""Exercise Hermes learned-skill and usage-sidecar CRUD without retaining data."""

from __future__ import annotations

import json
import os
import secrets
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FileSnapshot:
    existed: bool
    content: bytes = b""
    mode: int = 0o600


def snapshot_regular_file(path: Path) -> FileSnapshot:
    if path.is_symlink():
        raise RuntimeError(f"refusing symlinked skill state file: {path.name}")
    if not path.exists():
        return FileSnapshot(False)
    if not path.is_file():
        raise RuntimeError(f"skill state path is not a regular file: {path.name}")
    return FileSnapshot(True, path.read_bytes(), stat.S_IMODE(path.stat().st_mode))


def restore_regular_file(path: Path, snapshot: FileSnapshot) -> None:
    if path.is_symlink():
        raise RuntimeError(f"refusing symlinked skill state file during cleanup: {path.name}")
    if not snapshot.existed:
        if path.exists():
            path.unlink()
        return
    if path.exists() and path.is_file() and path.read_bytes() == snapshot.content:
        path.chmod(snapshot.mode)
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.restore-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(snapshot.content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, snapshot.mode)
        os.replace(temporary, path)
        path.chmod(snapshot.mode)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def require_success(raw: str, operation: str) -> dict:
    result = json.loads(raw)
    if result.get("success") is not True:
        raise RuntimeError(f"learned-skill {operation} failed")
    return result


def main() -> None:
    hermes_home = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser().resolve()
    skills_dir = hermes_home / "skills"
    if skills_dir.is_symlink() or not skills_dir.is_dir():
        raise SystemExit("Hermes skills root must be a real directory")

    usage_path = skills_dir / ".usage.json"
    usage_lock_path = skills_dir / ".usage.json.lock"
    usage_before = snapshot_regular_file(usage_path)
    lock_before = snapshot_regular_file(usage_lock_path)
    name = f"restore-smoke-{secrets.token_hex(8)}"
    skill_dir = skills_dir / name

    from tools import skill_usage
    from tools.skill_manager_tool import skill_manage

    content = (
        "---\n"
        f"name: {name}\n"
        "description: Disposable restore permission check; never retained.\n"
        "---\n\n"
        "# Disposable restore skill\n\n"
        "This content exists only inside the recovery smoke transaction.\n"
    )

    try:
        require_success(skill_manage("create", name, content=content), "create")
        if not skill_dir.is_dir() or skill_dir.is_symlink():
            raise RuntimeError("learned-skill create did not produce a regular directory")

        skill_usage.mark_agent_created(name)
        created = skill_usage.get_record(name)
        if created.get("created_by") != "agent":
            raise RuntimeError("usage sidecar create/read check failed")

        require_success(
            skill_manage(
                "write_file",
                name,
                file_path="references/smoke.md",
                file_content="Disposable restore reference.\n",
            ),
            "supporting-file create",
        )
        require_success(
            skill_manage(
                "patch",
                name,
                old_string="# Disposable restore skill",
                new_string="# Disposable restore skill updated",
            ),
            "update",
        )
        updated = skill_usage.get_record(name)
        if int(updated.get("patch_count") or 0) < 1:
            raise RuntimeError("usage sidecar update/read check failed")
        require_success(
            skill_manage("remove_file", name, file_path="references/smoke.md"),
            "supporting-file delete",
        )
        require_success(skill_manage("delete", name, absorbed_into=""), "delete")
        if skill_dir.exists() or name in skill_usage.load_usage():
            raise RuntimeError("learned-skill or usage-sidecar delete check failed")
    finally:
        if skill_dir.exists() and not skill_dir.is_symlink():
            shutil.rmtree(skill_dir)
        restore_regular_file(usage_path, usage_before)
        restore_regular_file(usage_lock_path, lock_before)

    print("Learned-skill and usage-sidecar disposable CRUD smoke check passed.")


if __name__ == "__main__":
    main()
