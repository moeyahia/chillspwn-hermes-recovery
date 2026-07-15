#!/usr/bin/env python3
"""Reject literal credentials in a live Hermes config without printing values."""

from __future__ import annotations

import argparse
import re
import stat
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import yaml


MAX_CONFIG_BYTES = 2 * 1024 * 1024
MAX_DEPTH = 64
MAX_NODES = 100_000
MAX_VIOLATIONS = 20

SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "bearer_token",
    "client_secret",
    "credential",
    "credentials",
    "id_token",
    "pass",
    "password",
    "passwd",
    "private_key",
    "proxy_authorization",
    "refresh_token",
    "secret",
    "signing_key",
    "token",
    "x_api_key",
}
SENSITIVE_SUFFIXES = (
    "_api_key",
    "_access_token",
    "_auth_token",
    "_bearer_token",
    "_client_secret",
    "_password",
    "_passwd",
    "_private_key",
    "_refresh_token",
    "_secret",
)
ENV_REFERENCE = re.compile(
    r"^(?:(?:Bearer|Basic)\s+)?(?:\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*)$"
)
HIGH_CONFIDENCE_SECRET = re.compile(
    r"(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|"
    r"\bAKIA[0-9A-Z]{16}\b|"
    r"\bAIza[0-9A-Za-z_-]{30,}\b|"
    r"\bgh[pousr]_[0-9A-Za-z]{24,}\b|"
    r"\bxox[baprs]-[0-9A-Za-z-]{20,}\b|"
    r"\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b)"
)
SECRET_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "client_secret",
    "key",
    "password",
    "secret",
    "sig",
    "signature",
    "token",
}


class UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loader that refuses ambiguous duplicate mapping keys."""


def _construct_unique_mapping(
    loader: UniqueKeyLoader,
    node: yaml.nodes.MappingNode,
    deep: bool = False,
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found an unhashable mapping key",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found a duplicate mapping key",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _display_path(parts: tuple[str, ...]) -> str:
    return ".".join(parts) if parts else "<root>"


def _path_label(key: Any) -> str:
    if isinstance(key, int):
        return str(key)
    if not isinstance(key, str):
        return "<complex-key>"
    if (
        len(key) <= 80
        and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key)
        and not HIGH_CONFIDENCE_SECRET.search(key)
    ):
        return key
    return "<redacted-key>"


def _normalized_key(key: Any) -> str:
    if not isinstance(key, str):
        return ""
    return re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")


def _is_sensitive_key(key: Any) -> bool:
    normalized = _normalized_key(key)
    return normalized in SENSITIVE_KEYS or normalized.endswith(SENSITIVE_SUFFIXES)


def _is_empty_or_reference(value: Any) -> bool:
    if value is None or value is False:
        return True
    if isinstance(value, str):
        stripped = value.strip()
        return not stripped or bool(ENV_REFERENCE.fullmatch(stripped))
    return False


def _url_contains_literal_credential(value: str) -> bool:
    if not value.lower().startswith(("http://", "https://")):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.username is not None or parsed.password is not None:
        return True
    for key, candidate in parse_qsl(parsed.query, keep_blank_values=True):
        if _normalized_key(key) in SECRET_QUERY_KEYS and not _is_empty_or_reference(candidate):
            return True
    return False


def validate_config(data: Any) -> list[str]:
    violations: list[str] = []
    active_ids: set[int] = set()
    node_count = 0

    def add(path: tuple[str, ...], reason: str) -> None:
        if len(violations) < MAX_VIOLATIONS:
            violations.append(f"{_display_path(path)}: {reason}")

    def walk(node: Any, path: tuple[str, ...], depth: int) -> None:
        nonlocal node_count
        node_count += 1
        if node_count > MAX_NODES:
            add(path, "configuration exceeds the node limit")
            return
        if depth > MAX_DEPTH:
            add(path, "configuration exceeds the nesting limit")
            return
        if len(violations) >= MAX_VIOLATIONS:
            return

        if isinstance(node, dict):
            identity = id(node)
            if identity in active_ids:
                add(path, "recursive YAML aliases are not allowed")
                return
            active_ids.add(identity)
            try:
                for key, value in node.items():
                    key_label = _path_label(key)
                    child_path = (*path, key_label)
                    if isinstance(key, str) and HIGH_CONFIDENCE_SECRET.search(key):
                        add(child_path, "high-confidence credential pattern in mapping key is prohibited")
                    if _is_sensitive_key(key) and not isinstance(value, (dict, list)):
                        if not _is_empty_or_reference(value):
                            add(child_path, "literal credential value is prohibited; use an environment reference")
                    walk(value, child_path, depth + 1)
            finally:
                active_ids.remove(identity)
            return

        if isinstance(node, list):
            identity = id(node)
            if identity in active_ids:
                add(path, "recursive YAML aliases are not allowed")
                return
            active_ids.add(identity)
            try:
                for index, value in enumerate(node):
                    walk(value, (*path, f"[{index}]"), depth + 1)
            finally:
                active_ids.remove(identity)
            return

        if isinstance(node, str):
            if HIGH_CONFIDENCE_SECRET.search(node):
                add(path, "high-confidence credential pattern is prohibited")
            if _url_contains_literal_credential(node):
                add(path, "URL-embedded credential is prohibited")

    walk(data, (), 0)
    return violations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate that Hermes config.yaml contains no literal credentials."
    )
    parser.add_argument("config", type=Path)
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="succeed when the configuration file does not exist",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path: Path = args.config
    try:
        info = path.lstat()
    except FileNotFoundError:
        if args.allow_missing:
            return 0
        print(f"Hermes configuration is missing: {path}", file=sys.stderr)
        return 1

    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        print(f"Hermes configuration is not a safe regular file: {path}", file=sys.stderr)
        return 1
    if info.st_size > MAX_CONFIG_BYTES:
        print(f"Hermes configuration exceeds {MAX_CONFIG_BYTES} bytes: {path}", file=sys.stderr)
        return 1

    try:
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.load(handle, Loader=UniqueKeyLoader)
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        print(f"Hermes configuration could not be validated: {type(exc).__name__}", file=sys.stderr)
        return 1

    if data is not None and not isinstance(data, dict):
        print("Hermes configuration root must be a mapping", file=sys.stderr)
        return 1
    violations = validate_config(data or {})
    if violations:
        print("Hermes configuration contains prohibited literal credential material:", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        if len(violations) == MAX_VIOLATIONS:
            print("  - additional findings omitted", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
