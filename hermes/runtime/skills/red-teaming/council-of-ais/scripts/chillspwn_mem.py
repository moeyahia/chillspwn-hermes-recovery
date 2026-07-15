#!/usr/bin/env python3
"""
chillspwn_mem.py — SAFE memory CLI for the ChillsPwn learning reviewer.

Wraps Hermes' MemoryStore (flock + char caps + injection scan) and adds the
governance the reviewer MUST obey, so that an automated model review can NEVER
silently destroy important knowledge:

  • BROKERED IN SERVICE MODE — when CHILLSPWN_MEMORY_SOCKET is configured, only
    add/safe-read are sent to the root-owned Unix-socket mediator. The ordinary
    service account has no raw memory-tree access. Curator verbs require a
    deliberate root/operator invocation outside broker client mode.

  • ADDITIVE-ONLY by default — `add` is allowed; `replace`/`remove` are REFUSED
    unless --curator is passed (the deliberate, gated consolidation path only).
    The reviewer is given the `add` verb only.
  • BACKUP-BEFORE-WRITE — every mutation first snapshots MEMORY.md + USER.md to a
    rotating backup dir. Nothing is ever lost; restore is a file copy.
  • PIN PROTECTION — entries marked with a pin marker (📌 / [PIN] / [PINNED]) are
    IMMUTABLE: replace/remove on a pinned entry is refused, even with --curator.
  • SOFT-DELETE — a curator `remove`/`replace` archives the old entry to
    ARCHIVE.md (with a timestamp) before changing MEMORY.md. Hard delete never
    happens here.
  • AUDIT LOG — every mutation AND every refusal is appended to audit.log as one
    JSON line: ts, action, target, actor, ok, detail, text.

Usage (the reviewer is instructed to call ONLY `add`):
  chillspwn_mem.py add     --target memory|user --text "..."  [--actor reviewer]
  chillspwn_mem.py pin     --target T --match "substring"      # protect an entry
  chillspwn_mem.py list    --target T                          # indexed + 📌 flag
  chillspwn_mem.py replace --curator --target T --match "..." --text "..."
  chillspwn_mem.py remove  --curator --target T --match "..."
  chillspwn_mem.py restore --backup <dir-name>                 # recover a snapshot
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path

HERMES_SRC = os.environ.get("CHILLSPWN_HERMES_SRC", "").strip()
if not HERMES_SRC:
    raise RuntimeError("CHILLSPWN_HERMES_SRC is required")
if not Path(HERMES_SRC, "tools").is_dir():
    raise RuntimeError("CHILLSPWN_HERMES_SRC does not contain the Hermes tools package")
if HERMES_SRC not in sys.path:
    sys.path.insert(0, HERMES_SRC)

from tools.memory_tool import MemoryStore, get_memory_dir, ENTRY_DELIMITER
from chillspwn_learn import generalize_reusable_text, reusable_content_violations

PIN_MARKERS = ("📌", "[PIN]", "[PINNED]")
MEM_CAP = 60000          # ChillsPwn treats MEMORY.md as a KB, not 2.2KB working memory
USER_CAP = 12000
KEEP_BACKUPS = 40
BROKER_MAX_RESPONSE = 256 * 1024


def _broker_socket():
    if os.environ.get("CHILLSPWN_MEMORY_BROKER_INTERNAL", "") == "1":
        return ""
    return os.environ.get("CHILLSPWN_MEMORY_SOCKET", "").strip()


def _broker_request(payload):
    """Send one bounded JSON request to the privileged memory mediator."""
    socket_path = _broker_socket()
    if not socket_path or not os.path.isabs(socket_path):
        return {"ok": False, "error": "memory broker socket is not configured"}
    request = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    if len(request) > 128 * 1024:
        return {"ok": False, "error": "memory broker request exceeds limit"}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(30)
            client.connect(socket_path)
            client.sendall(request)
            response = bytearray()
            while b"\n" not in response:
                chunk = client.recv(min(65536, BROKER_MAX_RESPONSE + 1 - len(response)))
                if not chunk:
                    break
                response.extend(chunk)
                if len(response) > BROKER_MAX_RESPONSE:
                    return {"ok": False, "error": "memory broker response exceeds limit"}
    except OSError:
        return {"ok": False, "error": "memory broker is unavailable"}
    try:
        result = json.loads(bytes(response).split(b"\n", 1)[0].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "error": "memory broker returned an invalid response"}
    return result if isinstance(result, dict) else {
        "ok": False,
        "error": "memory broker returned an invalid response",
    }


def _dispatch_broker(a):
    """Route non-privileged CLI use through the root-owned broker only."""
    if a.cmd == "add":
        result = _broker_request({
            "action": "add",
            "target": a.target,
            "content": a.text,
        })
    elif a.cmd == "safe-read":
        result = _broker_request({
            "action": "safe-read",
            "target": a.target,
            **({"path": a.path} if a.path else {}),
        })
        if a.format == "text":
            if result.get("ok") and isinstance(result.get("content"), str):
                print(result["content"])
            return 0 if result.get("ok") else 1
    else:
        result = {
            "ok": False,
            "error": (
                "the broker permits only add and safe-read; curator operations "
                "require an explicit root/operator invocation"
            ),
        }
    return _emit(result)


def contains_non_reusable_global(text):
    """Use the same strict reusable-content boundary as skills and AttackLesson.

    Flat memory has no dedicated References field, so literal URLs/domains are
    intentionally rejected along with target identities, usernames, and secrets.
    """
    return bool(reusable_content_violations(text or ""))


def non_reusable_global_violations(text):
    return reusable_content_violations(text or "")


def safe_read_memory(target, path=None):
    """Return only entries that already satisfy the reusable-content boundary.

    This is a fail-closed injection path for legacy files. Dirty entries are
    counted but never returned, logged, audited, or partially echoed. An optional
    path must remain beneath the configured memories directory (project memory).
    """
    if _broker_socket():
        return _broker_request({
            "action": "safe-read",
            "target": target,
            **({"path": str(path)} if path else {}),
        })
    memory_dir = Path(get_memory_dir()).resolve()
    candidate = Path(path).expanduser() if path else memory_dir / (
        "USER.md" if target == "user" else "MEMORY.md"
    )
    try:
        candidate = candidate.resolve()
        candidate.relative_to(memory_dir)
    except (OSError, ValueError):
        return {
            "ok": False,
            "error": "memory path is outside the configured memory directory",
            "content": "",
            "included": 0,
            "excluded": 0,
        }
    if not candidate.is_file():
        return {"ok": True, "content": "", "included": 0, "excluded": 0}
    try:
        raw = candidate.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {
            "ok": False,
            "error": "memory file is unreadable",
            "content": "",
            "included": 0,
            "excluded": 0,
        }
    clean = []
    excluded = 0
    for entry in raw.split(ENTRY_DELIMITER):
        entry = entry.strip()
        if not entry:
            continue
        if reusable_content_violations(entry):
            excluded += 1
            continue
        clean.append(entry)
    return {
        "ok": True,
        "content": ENTRY_DELIMITER.join(clean),
        "included": len(clean),
        "excluded": excluded,
    }


def _now():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _is_pinned(entry: str) -> bool:
    return any(m in entry for m in PIN_MARKERS)


def _backup_dir() -> Path:
    return get_memory_dir() / "backups"


def _snapshot(reason: str) -> str:
    """Copy MEMORY.md + USER.md into backups/<ts>_<reason>/ ; prune old ones."""
    md = get_memory_dir()
    dest = _backup_dir() / f"{_now()}_{reason}"
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("MEMORY.md", "USER.md"):
        src = md / name
        if src.exists():
            shutil.copy2(src, dest / name)
    # prune: keep newest KEEP_BACKUPS
    snaps = sorted([p for p in _backup_dir().iterdir() if p.is_dir()])
    for old in snaps[:-KEEP_BACKUPS]:
        shutil.rmtree(old, ignore_errors=True)
    return dest.name


def _safe_audit_detail(detail):
    """Redact operational errors before they enter the durable audit stream."""
    safe, _ = generalize_reusable_text(str(detail or ""))
    safe = re.sub(r"(?i)\b(?:https?|ftp)://\S+", "<URL>", safe)
    safe = re.sub(
        r"(?i)(?:[A-Z]:[\\/]|/(?:root|home|tmp|var|opt|srv)/)[^\s,;]+",
        "<PATH>",
        safe,
    )
    return " ".join(safe.split())[:400]


def _audit(action, target, actor, ok, detail, text=""):
    raw = (text or "").encode("utf-8", errors="replace")
    rec = {"ts": _now(), "action": action, "target": target, "actor": actor,
           "ok": ok, "detail": _safe_audit_detail(detail),
           "content_sha256": hashlib.sha256(raw).hexdigest(),
           "content_length": len(raw)}
    try:
        with open(get_memory_dir() / "audit.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _archive(target, entry, reason):
    """Soft-delete: append the entry to ARCHIVE.md before it leaves MEMORY.md."""
    arc = get_memory_dir() / "ARCHIVE.md"
    block = f"\n§ archived {_now()} from {target.upper()} ({reason}):\n{entry}\n"
    with open(arc, "a", encoding="utf-8") as f:
        f.write(block)


def _store():
    # This CLI is the mediated writer selected by the ChillsPwn deployment.
    # Ordinary Hermes MemoryStore instances are mutation-disabled while the
    # guard is active; this instance still performs the validated, audited,
    # backup-before-write workflow below.
    ms = MemoryStore(
        memory_char_limit=MEM_CAP,
        user_char_limit=USER_CAP,
        mediated_writer=True,
    )
    ms.load_from_disk()
    return ms


def _entries(ms, target):
    return ms.user_entries if target == "user" else ms.memory_entries


def _emit(d):
    print(json.dumps(d, ensure_ascii=False))
    return 0 if d.get("ok") or d.get("success") else 1


def _evict_to_fit(ms, target, incoming_text, actor):
    """Rolling eviction so MEMORY/USER never HARD-FAILS at the cap. If adding `incoming_text` would
    exceed the char cap, soft-delete the OLDEST non-pinned entries to ARCHIVE.md until there is room
    (with slack for delimiter/accounting differences). 📌 PINNED entries are never evicted. Returns
    the count evicted. This replaces the old behavior where, once MEMORY.md hit the 60k cap, EVERY
    new durable fact was silently rejected (14k failed auto-promotes) and learning effectively
    stopped — nothing was ever lost (soft-delete archives), it just rolls over."""
    cap = USER_CAP if target == "user" else MEM_CAP
    slack = 512
    need = len(incoming_text or "")
    sep = len(ENTRY_DELIMITER)
    evicted = 0
    guard = 0
    failed = set()  # victims that couldn't be removed — SKIP them, never let one jam the rollover
    while guard < 5000:
        guard += 1
        entries = _entries(ms, target)
        cur = len(ENTRY_DELIMITER.join(entries)) if entries else 0
        if cur + sep + need <= cap - slack:
            break
        # Pick the oldest non-pinned entry we haven't already failed to remove. ms.remove() matches
        # by SUBSTRING and refuses an ambiguous match, so an entry that is a prefix/substring of a
        # newer one (e.g. a short cred line later re-saved with more detail) can't be removed that
        # way — DON'T break on it (that froze ALL eviction and rejected every new fact); skip it and
        # keep evicting the rest until there's room.
        victim = next((e for e in entries if not _is_pinned(e) and e not in failed), None)
        if victim is None:
            break  # nothing left we can evict (all pinned, or all remaining are un-removable)
        r = ms.remove(target, victim)
        if not (bool(r.get("success", True)) and not r.get("error")):
            failed.add(victim)  # ambiguous / un-removable — skip and try the next oldest
            continue
        _archive(target, victim, "evicted-at-cap")  # archive AFTER a confirmed removal
        ms.load_from_disk()  # re-sync in-memory entries with what was just written
        _audit("evict", target, actor, True, "rolling eviction at cap (oldest non-pinned archived)", victim)
        evicted += 1
    return evicted


def cmd_add(a):
    # Flat shared memory is reusable planning context regardless of actor. Attack chains belong
    # in generalized playbooks; raw target state remains in evidence/session storage.
    violations = non_reusable_global_violations(a.text or "")
    if violations:
        detail = "automated memory write rejected: " + ", ".join(sorted(set(violations)))
        _audit("add", a.target, a.actor, False, detail, a.text)
        return _emit({"ok": False, "error": detail, "violations": sorted(set(violations))})
    ms = _store()
    normalized = (a.text or "").strip()
    if any((entry or "").strip() == normalized for entry in _entries(ms, a.target)):
        _audit("add", a.target, a.actor, True, "already present (idempotent skip)", a.text)
        return _emit({"ok": True, "message": "already present (idempotent skip)", "skipped": True})
    _snapshot("add")
    evicted = _evict_to_fit(ms, a.target, a.text, a.actor)
    r = ms.add(a.target, a.text)
    ok = bool(r.get("success", True)) and not r.get("error")
    msg = r.get("message", "added")
    if evicted:
        msg = f"{msg} (rolling-evicted {evicted} oldest non-pinned to ARCHIVE.md to fit cap)"
    _audit("add", a.target, a.actor, ok, r.get("error") or msg, a.text)
    return _emit({"ok": ok, **({} if ok else {"error": r.get("error")}),
                  "message": msg, **({"evicted": evicted} if evicted else {})})


def cmd_safe_read(a):
    result = safe_read_memory(a.target, a.path)
    if a.format == "text":
        if result.get("ok") and result.get("content"):
            print(result["content"])
        return 0 if result.get("ok") else 1
    return _emit(result)


def cmd_pin(a):
    """Non-destructive: prepend a pin marker to the matched entry."""
    ms = _store()
    entries = _entries(ms, a.target)
    matches = [e for e in entries if a.match in e]
    if not matches:
        _audit("pin", a.target, a.actor, False, "no match", a.match)
        return _emit({"ok": False, "error": f"No entry matched '{a.match}'."})
    if len({*matches}) > 1:
        return _emit({"ok": False, "error": "Ambiguous match — be more specific.",
                      "matches": [m[:80] for m in matches]})
    entry = matches[0]
    if _is_pinned(entry):
        return _emit({"ok": True, "message": "Already pinned."})
    _snapshot("pin")
    r = ms.replace(a.target, entry, f"📌 {entry}")
    ok = bool(r.get("success", True)) and not r.get("error")
    _audit("pin", a.target, a.actor, ok, r.get("error") or "pinned", entry)
    return _emit({"ok": ok, **({} if ok else {"error": r.get("error")}), "message": "pinned"})


def cmd_replace(a):
    if not a.curator:
        _audit("replace", a.target, a.actor, False, "BLOCKED: additive-only (no --curator)", a.match)
        return _emit({"ok": False, "error": "replace is blocked. The reviewer is additive-only; "
                      "destructive edits require the curator path (--curator)."})
    violations = non_reusable_global_violations(a.text or "")
    if violations:
        detail = "curator replacement rejected: " + ", ".join(sorted(set(violations)))
        _audit("replace", a.target, a.actor, False, detail, a.text)
        return _emit({"ok": False, "error": detail, "violations": sorted(set(violations))})
    ms = _store()
    matches = [e for e in _entries(ms, a.target) if a.match in e]
    if not matches:
        return _emit({"ok": False, "error": f"No entry matched '{a.match}'."})
    if any(_is_pinned(e) for e in matches):
        _audit("replace", a.target, a.actor, False, "BLOCKED: pinned entry", a.match)
        return _emit({"ok": False, "error": "Refused: matched a 📌 PINNED entry (immutable)."})
    _snapshot("replace")
    for e in {*matches}:
        _archive(a.target, e, "replace")
    r = ms.replace(a.target, a.match, a.text)
    ok = bool(r.get("success", True)) and not r.get("error")
    _audit("replace", a.target, a.actor, ok, r.get("error") or "replaced", a.text)
    return _emit({"ok": ok, **({} if ok else {"error": r.get("error")}), "message": "replaced (old archived)"})


def cmd_remove(a):
    if not a.curator:
        _audit("remove", a.target, a.actor, False, "BLOCKED: additive-only (no --curator)", a.match)
        return _emit({"ok": False, "error": "remove is blocked. The reviewer is additive-only; "
                      "deletion requires the curator path (--curator) and only soft-deletes to ARCHIVE.md."})
    ms = _store()
    matches = [e for e in _entries(ms, a.target) if a.match in e]
    if not matches:
        return _emit({"ok": False, "error": f"No entry matched '{a.match}'."})
    if any(_is_pinned(e) for e in matches):
        _audit("remove", a.target, a.actor, False, "BLOCKED: pinned entry", a.match)
        return _emit({"ok": False, "error": "Refused: matched a 📌 PINNED entry (immutable)."})
    _snapshot("remove")
    for e in {*matches}:
        _archive(a.target, e, "remove")
    r = ms.remove(a.target, a.match)
    ok = bool(r.get("success", True)) and not r.get("error")
    _audit("remove", a.target, a.actor, ok, r.get("error") or "removed", a.match)
    return _emit({"ok": ok, **({} if ok else {"error": r.get("error")}), "message": "soft-deleted (archived)"})


def cmd_list(a):
    ms = _store()
    out = []
    for i, e in enumerate(_entries(ms, a.target)):
        out.append({"i": i, "pinned": _is_pinned(e), "chars": len(e),
                    "preview": e[:120] + ("…" if len(e) > 120 else "")})
    cur = len(ENTRY_DELIMITER.join(_entries(ms, a.target)))
    cap = USER_CAP if a.target == "user" else MEM_CAP
    return _emit({"ok": True, "target": a.target, "count": len(out),
                  "chars": f"{cur}/{cap}", "entries": out})


def cmd_dedup(a):
    """Maintenance: drop entries that are exact-duplicates or PROPER SUBSTRINGS of a longer entry
    (a short fact later re-saved with more detail — the text survives verbatim in the superset, so
    nothing is lost). 📌 PINNED entries are never touched. Snapshots first, soft-deletes to
    ARCHIVE.md. Idempotent. `--dry-run` reports what WOULD go without changing anything. Keeps GLOBAL
    memory lean without raising the per-turn cap (the whole file is injected into every prompt)."""
    target = a.target
    ms = _store()
    ents = list(_entries(ms, target))
    n = len(ents)
    st = [e.strip() for e in ents]
    pinned = [_is_pinned(e) for e in ents]
    redundant = set()
    seen = {}
    for i in range(n):
        if pinned[i] or not st[i]:
            continue
        if st[i] in seen:           # exact duplicate of an earlier (kept) entry
            redundant.add(i); continue
        seen[st[i]] = i
        for j in range(n):          # proper substring of a different, LONGER entry
            if j != i and len(st[j]) > len(st[i]) and st[i] in st[j]:
                redundant.add(i); break
    removed = [ents[i] for i in sorted(redundant)]
    if getattr(a, "dry_run", False):
        return _emit({"ok": True, "dry_run": True, "target": target, "entries": n,
                      "would_remove": len(removed), "preview": [e[:100] for e in removed[:20]]})
    if not removed:
        return _emit({"ok": True, "target": target, "removed": 0, "message": "no redundant entries"})
    _snapshot("dedup")
    with ms._file_lock(ms._path_for(target)):
        ms._reload_target(target)
        survivors = list(ms._entries_for(target))
        for e in removed:                 # remove ONE occurrence each (handles exact-dup multiplicity)
            if e in survivors:
                survivors.remove(e)
        ms._set_entries(target, survivors)
        ms.save_to_disk(target)
    for e in removed:
        _archive(target, e, "dedup-prefix-collision")
    _audit("dedup", target, a.actor, True, f"removed {len(removed)} redundant (substring/exact-dup) entries", str(len(removed)))
    return _emit({"ok": True, "target": target, "removed": len(removed),
                  "message": f"deduped {len(removed)} redundant entries to ARCHIVE.md"})


def cmd_restore(a):
    src = _backup_dir() / a.backup
    if not src.is_dir():
        return _emit({"ok": False, "error": f"No backup '{a.backup}'. See: {_backup_dir()}"})
    rejected = {}
    for name, target in (("MEMORY.md", "memory"), ("USER.md", "user")):
        source_file = src / name
        if not source_file.exists():
            continue
        result = safe_read_memory(target, source_file)
        if not result.get("ok") or result.get("excluded", 0):
            rejected[name] = int(result.get("excluded", 0))
    if rejected:
        detail = "restore rejected: backup contains non-reusable entries in " + ", ".join(
            f"{name} ({count})" for name, count in sorted(rejected.items())
        )
        _audit("restore", "both", a.actor, False, detail)
        return _emit({
            "ok": False,
            "error": detail,
            "files": sorted(rejected),
        })
    _snapshot("pre-restore")
    md = get_memory_dir()
    restored = []
    for name in ("MEMORY.md", "USER.md"):
        s = src / name
        if s.exists():
            shutil.copy2(s, md / name)
            restored.append(name)
    _audit("restore", "both", a.actor, True, f"restored {restored} from {a.backup}")
    return _emit({"ok": True, "restored": restored, "from": a.backup})


def main():
    ap = argparse.ArgumentParser(description="Safe, additive-only memory CLI for the ChillsPwn reviewer.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, need_target=True):
        if need_target:
            p.add_argument("--target", choices=["memory", "user"], required=True)
        p.add_argument("--actor", default="reviewer", help="who is making the change (for the audit log)")

    p = sub.add_parser("add"); common(p)
    add_input = p.add_mutually_exclusive_group(required=True)
    add_input.add_argument("--text")
    add_input.add_argument(
        "--stdin",
        action="store_true",
        help="read entry content from stdin so it never appears in the process list",
    )
    p.set_defaults(fn=cmd_add)
    p = sub.add_parser("safe-read")
    p.add_argument("--target", choices=["memory", "user"], required=True)
    p.add_argument("--path", help="optional project-memory path beneath the configured memories dir")
    p.add_argument("--format", choices=["json", "text"], default="json")
    p.set_defaults(fn=cmd_safe_read)
    p = sub.add_parser("pin"); common(p); p.add_argument("--match", required=True); p.set_defaults(fn=cmd_pin)
    p = sub.add_parser("list"); common(p); p.set_defaults(fn=cmd_list)
    p = sub.add_parser("replace"); common(p); p.add_argument("--match", required=True)
    p.add_argument("--text", required=True); p.add_argument("--curator", action="store_true"); p.set_defaults(fn=cmd_replace)
    p = sub.add_parser("remove"); common(p); p.add_argument("--match", required=True)
    p.add_argument("--curator", action="store_true"); p.set_defaults(fn=cmd_remove)
    p = sub.add_parser("dedup"); common(p); p.add_argument("--dry-run", action="store_true")
    p.set_defaults(fn=cmd_dedup)
    p = sub.add_parser("restore"); common(p, need_target=False)
    p.add_argument("--backup", required=True); p.set_defaults(fn=cmd_restore)

    a = ap.parse_args()
    if a.cmd == "add" and getattr(a, "stdin", False):
        a.text = sys.stdin.read()
    if _broker_socket():
        sys.exit(_dispatch_broker(a))
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
