#!/usr/bin/env python3
"""Regression tests for the live Hermes config secret boundary."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = REPO_ROOT / "scripts/validate-hermes-config.py"


class HermesConfigValidatorTests(unittest.TestCase):
    def run_validator(self, content: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.yaml"
            config.write_text(content, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(VALIDATOR), str(config)],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_allows_nonsecret_configuration_and_environment_references(self) -> None:
        result = self.run_validator(
            """
model:
  provider: openrouter
  name: example/model
providers:
  example:
    base_url: https://provider.example/v1
    api_key: ${OPENROUTER_API_KEY}
mcp_servers:
  example:
    env:
      EXAMPLE_TOKEN: $EXAMPLE_TOKEN
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_literal_sensitive_field_without_echoing_value(self) -> None:
        literal = "literal-provider-credential-for-test"
        result = self.run_validator(
            f"providers:\n  example:\n    api_key: {literal}\n"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("providers.example.api_key", result.stderr)
        self.assertNotIn(literal, result.stderr)

    def test_rejects_url_embedded_credentials(self) -> None:
        result = self.run_validator(
            "providers:\n  example:\n    base_url: https://user:pass@provider.example/v1\n"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("URL-embedded credential", result.stderr)

    def test_rejects_duplicate_yaml_keys(self) -> None:
        result = self.run_validator("model:\n  provider: first\n  provider: second\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ConstructorError", result.stderr)

    def test_does_not_echo_untrusted_mapping_keys(self) -> None:
        untrusted_key = "gh" + "p_" + ("A" * 30)
        result = self.run_validator(f"{untrusted_key}: harmless\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("<redacted-key>", result.stderr)
        self.assertNotIn(untrusted_key, result.stderr)


if __name__ == "__main__":
    unittest.main()
