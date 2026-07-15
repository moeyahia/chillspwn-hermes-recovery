#!/usr/bin/env python3
"""Initialize and validate the shared Hermes/ChillsPwn Mission Board.

This helper deliberately creates no durable cards or board columns. It uses
Hermes's retained ``kanban_db.init_db`` entry point for the base schema, applies
only ChillsPwn's additive table/columns, and runs CRUD inside a transaction that
is always rolled back.
"""

from __future__ import annotations

import argparse
import os
import secrets
import sqlite3
import time
from pathlib import Path


CHILLSPWN_TASK_COLUMNS: dict[str, str] = {
    "agent_session_id": "TEXT",
    "engagement": "TEXT",
    "tools_used": "TEXT",
    "dispatched_at": "INTEGER",
    "agent_provider": "TEXT",
}

BASE_TABLES = {
    "tasks",
    "task_links",
    "task_comments",
    "task_events",
    "task_runs",
    "kanban_notify_subs",
}

BASE_TASK_COLUMNS = {
    "id",
    "title",
    "body",
    "assignee",
    "status",
    "priority",
    "result",
    "created_by",
    "created_at",
    "workspace_kind",
    "model_override",
    "worker_pid",
    "last_failure_error",
    "current_run_id",
    "max_retries",
    "session_id",
}

BOARD_COLUMN_COLUMNS = {
    "persona",
    "position",
    "wip_limit",
    "enabled",
    "is_backlog",
    "created_at",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Initialize Hermes kanban.db and validate ChillsPwn's additive board schema."
    )
    parser.add_argument("--db", required=True, type=Path, help="Exact kanban.db path")
    return parser.parse_args()


def table_names(conn: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')}


def require_schema(conn: sqlite3.Connection) -> None:
    missing_tables = sorted(BASE_TABLES - table_names(conn))
    if missing_tables:
        raise RuntimeError(f"Hermes Kanban schema is missing table(s): {', '.join(missing_tables)}")

    task_columns = table_columns(conn, "tasks")
    missing_base = sorted(BASE_TASK_COLUMNS - task_columns)
    if missing_base:
        raise RuntimeError(
            f"Hermes tasks schema is missing base column(s): {', '.join(missing_base)}"
        )

    missing_additive = sorted(set(CHILLSPWN_TASK_COLUMNS) - task_columns)
    if missing_additive:
        raise RuntimeError(
            f"ChillsPwn tasks schema is missing additive column(s): {', '.join(missing_additive)}"
        )

    board_columns = table_columns(conn, "board_columns")
    missing_board = sorted(BOARD_COLUMN_COLUMNS - board_columns)
    if missing_board:
        raise RuntimeError(
            f"ChillsPwn board_columns schema is missing column(s): {', '.join(missing_board)}"
        )

    quick_check = [str(row[0]) for row in conn.execute("PRAGMA quick_check")]
    if quick_check != ["ok"]:
        raise RuntimeError("SQLite quick_check did not return ok")


def apply_chillspwn_schema(conn: sqlite3.Connection) -> None:
    """Apply only additive ChillsPwn schema changes in one transaction."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        if "tasks" not in table_names(conn):
            raise RuntimeError("Hermes base tasks table is absent")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_columns (
                persona TEXT PRIMARY KEY,
                position INTEGER NOT NULL DEFAULT 0,
                wip_limit INTEGER NOT NULL DEFAULT 2,
                enabled INTEGER NOT NULL DEFAULT 1,
                is_backlog INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )

        existing = table_columns(conn, "tasks")
        for name, column_type in CHILLSPWN_TASK_COLUMNS.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE tasks ADD COLUMN "{name}" {column_type}')

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def rollback_crud_smoke(conn: sqlite3.Connection) -> None:
    """Exercise board create/read/update/delete, then roll back every test row."""
    suffix = secrets.token_hex(8)
    task_id = f"__restore_smoke_task_{suffix}"
    persona = f"__restore_smoke_persona_{suffix}"
    now = int(time.time())

    conn.execute("BEGIN IMMEDIATE")
    try:
        if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise RuntimeError("unexpected Mission Board smoke task collision")

        conn.execute(
            """
            INSERT INTO board_columns (
                persona, position, wip_limit, enabled, is_backlog, created_at
            ) VALUES (?, 999999, 1, 1, 0, ?)
            """,
            (persona, now),
        )
        conn.execute(
            """
            INSERT INTO tasks (
                id, title, body, assignee, status, priority, created_by,
                created_at, workspace_kind, agent_session_id, engagement,
                tools_used, agent_provider
            ) VALUES (?, ?, ?, ?, 'ready', 0, 'restore-smoke', ?, 'scratch', ?, '', '[]', 'restore-smoke')
            """,
            (task_id, "Restore smoke task", "Rolled back before exit.", persona, now, task_id),
        )
        conn.execute(
            "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, 'restore_smoke', '{}', ?)",
            (task_id, now),
        )

        created = conn.execute(
            "SELECT status, assignee, agent_provider FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not created or tuple(created) != ("ready", persona, "restore-smoke"):
            raise RuntimeError("Mission Board smoke create/read check failed")

        conn.execute(
            "UPDATE tasks SET status='done', result='restore-smoke-updated', tools_used='[\"restore-smoke\"]' WHERE id = ?",
            (task_id,),
        )
        updated = conn.execute(
            "SELECT status, result, tools_used FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not updated or tuple(updated) != (
            "done",
            "restore-smoke-updated",
            '["restore-smoke"]',
        ):
            raise RuntimeError("Mission Board smoke update/read check failed")

        conn.execute("DELETE FROM task_events WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.execute("DELETE FROM board_columns WHERE persona = ?", (persona,))
        if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise RuntimeError("Mission Board smoke delete check failed")
    finally:
        # The smoke test is evidence about behavior, never operational data.
        if conn.in_transaction:
            conn.execute("ROLLBACK")

    if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
        raise RuntimeError("rolled-back Mission Board smoke task persisted unexpectedly")
    if conn.execute("SELECT 1 FROM board_columns WHERE persona = ?", (persona,)).fetchone():
        raise RuntimeError("rolled-back Mission Board smoke column persisted unexpectedly")


def main() -> None:
    args = parse_args()
    db_path = args.db.expanduser()
    if not db_path.is_absolute():
        raise SystemExit("--db must be an absolute path")
    if db_path.is_symlink():
        raise SystemExit("refusing a symlinked kanban.db")
    if db_path.exists() and not db_path.is_file():
        raise SystemExit("kanban.db exists but is not a regular file")

    # Apply a restrictive creation mask before Hermes opens a fresh database.
    os.umask(0o077)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    from hermes_cli import kanban_db

    initialized = kanban_db.init_db(db_path=db_path)
    if initialized.resolve() != db_path.resolve():
        raise RuntimeError("Hermes initialized an unexpected Kanban database path")

    conn = sqlite3.connect(db_path, isolation_level=None, timeout=30)
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        apply_chillspwn_schema(conn)
        require_schema(conn)
        rollback_crud_smoke(conn)
        require_schema(conn)
    finally:
        conn.close()

    db_path.chmod(0o600)
    print("Mission Board schema and rolled-back CRUD smoke check passed.")


if __name__ == "__main__":
    main()
