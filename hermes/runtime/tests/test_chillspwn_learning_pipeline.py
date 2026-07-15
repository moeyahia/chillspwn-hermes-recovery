#!/usr/bin/env python3
"""Focused regression tests for ChillsPwn's post-session learning boundary."""

import ast
import grp
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
LEARNER_DIR = (
    REPO_ROOT
    / "hermes/runtime/skills/red-teaming/council-of-ais/scripts"
)
HERMES_SRC = REPO_ROOT / "hermes/source"
os.environ.setdefault("CHILLSPWN_HERMES_SRC", str(HERMES_SRC))
if str(LEARNER_DIR) not in sys.path:
    sys.path.insert(0, str(LEARNER_DIR))

import chillspwn_learn as learn  # noqa: E402
import chillspwn_mem as memory_cli  # noqa: E402
import chillspwn_skill as skill_cli  # noqa: E402
import council_summon  # noqa: E402
from agent.file_safety import get_read_block_error, is_write_denied  # noqa: E402
from tools import memory_tool as hermes_memory  # noqa: E402


VALID_PLAYBOOK = """# Generalized Service Validation Chain

## Prerequisites and Signals
- The authorized target exposes the expected service.

## Ordered Attack Chain
1. Confirm the service behavior.
2. Exercise the approved technique.

## Command Templates
```bash
curl <TARGET_URL>
```

## Validation
- Confirm the expected response without retaining target artifacts.

## Failure Recovery
- Recheck scope, transport, and tool syntax before retrying.

## Cleanup
- Remove temporary artifacts and stop transient listeners.

## Tools
- curl

## References
- https://curl.se/docs/manpage.html
"""


class ReusableContentTests(unittest.TestCase):
    def test_claude_prompt_is_sent_over_stdin(self):
        completed = SimpleNamespace(returncode=0, stdout="@NOTHING\n", stderr="")
        prompt = "x" * 300_000
        with mock.patch.object(learn.subprocess, "run", return_value=completed) as run:
            ok, output = learn.run_claude(prompt, "test-model", log=lambda _message: None)
        self.assertTrue(ok)
        self.assertEqual(output, "@NOTHING\n")
        argv = run.call_args.args[0]
        self.assertNotIn(prompt, argv)
        self.assertEqual(run.call_args.kwargs["input"], prompt)

    def test_failed_reviewer_output_is_fingerprinted_not_logged(self):
        captured_secret = "example-captured-value"
        completed = SimpleNamespace(
            returncode=1,
            stdout=f"password was {captured_secret}",
            stderr=f"credential exampleuser:{captured_secret}",
        )
        logs = []
        with mock.patch.object(learn.subprocess, "run", return_value=completed):
            ok, _output = learn.run_claude("review", "test-model", log=logs.append)
        self.assertFalse(ok)
        rendered = "\n".join(logs)
        self.assertNotIn(captured_secret, rendered)
        self.assertIn("sha256=", rendered)

    def test_nothing_must_be_explicit_and_exact(self):
        self.assertTrue(learn.parse_directives("@NOTHING")["nothing"])
        self.assertIsNone(learn.parse_directives("@NOTHING\nextra prose"))

    def test_generalization_removes_fabricated_target_and_secret_values(self):
        raw = (
            "Target ExampleNode user=exampleuser -u seconduser "
            "http://192.0.2.44/path demo.internal password was examplepass "
            "credential thirduser:anotherpass"
        )
        generalized, replacements = learn.generalize_reusable_text(
            raw,
            "/root/engagements/ExampleNode",
        )
        self.assertIn("<TARGET_CONTEXT>", generalized)
        self.assertIn("<USER_REF>", generalized)
        self.assertIn("<TARGET_HOST>", generalized)
        self.assertIn("<TARGET_DOMAIN>", generalized)
        self.assertIn("<CREDENTIAL_REF>", generalized)
        self.assertTrue(replacements)
        self.assertEqual(
            learn.reusable_content_violations(
                generalized,
                "/root/engagements/ExampleNode",
            ),
            [],
        )

    def test_complete_playbook_allows_public_url_only_in_references(self):
        self.assertEqual(
            learn.reusable_content_violations(
                VALID_PLAYBOOK,
                require_playbook=True,
                reference_aware=True,
            ),
            [],
        )
        unsafe = VALID_PLAYBOOK.replace(
            "curl <TARGET_URL>",
            "curl https://service.example.org/path",
        )
        problems = learn.reusable_content_violations(
            unsafe,
            require_playbook=True,
            reference_aware=True,
        )
        self.assertIn("literal URL outside References", problems)
        self.assertIn("literal domain outside References", problems)

    def test_strict_scan_covers_username_and_named_target(self):
        self.assertIn(
            "target username",
            learn.reusable_content_violations("username=exampleuser"),
        )
        self.assertIn(
            "named target",
            learn.reusable_content_violations("target named examplenode"),
        )
        self.assertIn(
            "named target",
            learn.reusable_content_violations('host "examplenode"'),
        )
        for example in (
            "Use username exampleuser with smbclient",
            "login as exampleuser",
            "user exampleuser",
            "password is examplepass",
            "secret was examplepass",
            "use token exampletoken",
            "credential exampleuser:examplepass",
            "login with exampleuser and examplepass",
        ):
            self.assertTrue(learn.reusable_content_violations(example), example)
        for safe in (
            "Use username <USER_REF> with smbclient",
            "login as <USER_REF>",
            "password is <CREDENTIAL_REF>",
            "use token <TOKEN_REF>",
            "credential <USER_REF>:<CREDENTIAL_REF>",
            "login with <USER_REF> and <CREDENTIAL_REF>",
            "user enumeration and account management use token authentication",
            "target authentication and host validation",
        ):
            self.assertEqual(learn.reusable_content_violations(safe), [], safe)
        self.assertTrue(memory_cli.contains_non_reusable_global(
            "See https://docs.example.org for provider behavior."
        ))

    def test_memory_audit_hashes_rejected_content(self):
        captured_secret = "example-captured-value"
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_cli,
            "get_memory_dir",
            return_value=Path(temporary),
        ):
            memory_cli._audit(
                "add",
                "memory",
                "reviewer",
                False,
                f"password was {captured_secret} at /root/private/location",
                f"credential exampleuser:{captured_secret}",
            )
            payload = (Path(temporary) / "audit.log").read_text()
        self.assertNotIn(captured_secret, payload)
        record = json.loads(payload)
        self.assertIn("content_sha256", record)
        self.assertIn("content_length", record)
        self.assertNotIn("text", record)
        self.assertIn("<PATH>", record["detail"])

    def test_safe_read_excludes_dirty_legacy_entry(self):
        captured_secret = "example-captured-value"
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_cli,
            "get_memory_dir",
            return_value=Path(temporary),
        ):
            memory_path = Path(temporary) / "MEMORY.md"
            memory_path.write_text(
                "Generic provider retries use bounded backoff.\n§\n"
                f"password was {captured_secret}"
            )
            result = memory_cli.safe_read_memory("memory")
        self.assertTrue(result["ok"])
        self.assertEqual(result["included"], 1)
        self.assertEqual(result["excluded"], 1)
        self.assertIn("bounded backoff", result["content"])
        self.assertNotIn(captured_secret, json.dumps(result))

    def test_every_add_and_curator_replace_validate_reusable_content(self):
        captured_secret = "example-captured-value"
        add_args = SimpleNamespace(
            target="memory",
            actor="manual-operator",
            text=f"password was {captured_secret}",
        )
        replace_args = SimpleNamespace(
            target="memory",
            actor="curator",
            text=f"login with exampleuser and {captured_secret}",
            match="old entry",
            curator=True,
        )
        with mock.patch.object(memory_cli, "_audit"), mock.patch.object(
            memory_cli,
            "_store",
        ) as store, redirect_stdout(io.StringIO()):
            self.assertEqual(memory_cli.cmd_add(add_args), 1)
            self.assertEqual(memory_cli.cmd_replace(replace_args), 1)
        store.assert_not_called()

    def test_restore_rejects_dirty_backup_before_copy(self):
        captured_secret = "example-captured-value"
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_cli,
            "get_memory_dir",
            return_value=Path(temporary),
        ):
            root = Path(temporary)
            root.joinpath("MEMORY.md").write_text("Current clean memory.")
            backup = root / "backups/dirty-backup"
            backup.mkdir(parents=True)
            backup.joinpath("MEMORY.md").write_text(
                f"credential exampleuser:{captured_secret}"
            )
            output = io.StringIO()
            with redirect_stdout(output):
                rc = memory_cli.cmd_restore(SimpleNamespace(
                    backup="dirty-backup",
                    actor="curator",
                ))
            self.assertEqual(rc, 1)
            self.assertEqual(root.joinpath("MEMORY.md").read_text(), "Current clean memory.")
            self.assertNotIn(captured_secret, output.getvalue())
            self.assertNotIn(captured_secret, root.joinpath("audit.log").read_text())

    def test_hooks_inject_only_safe_read_output(self):
        captured_secret = "example-captured-value"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "home"
            hermes_home = home / ".hermes"
            memories = hermes_home / "memories"
            memories.mkdir(parents=True)
            memories.joinpath("USER.md").write_text("Prefer concise status updates.")
            memories.joinpath("MEMORY.md").write_text(
                "Generic provider retries use bounded backoff.\n§\n"
                f"password was {captured_secret}"
            )
            env = {
                **os.environ,
                "HOME": str(home),
                "HERMES_HOME": str(hermes_home),
                "HERMES_PYTHON": sys.executable,
                "CHILLSPWN_HERMES_SRC": str(HERMES_SRC),
                "CHILLSPWN_MEM_CLI": str(LEARNER_DIR / "chillspwn_mem.py"),
            }
            session_hook = REPO_ROOT / "chillspwn/plugin/hooks/scripts/session-start.sh"
            compact_hook = REPO_ROOT / "chillspwn/plugin/hooks/scripts/pre-compact-memory.sh"
            session = subprocess.run(
                [str(session_hook)],
                input=json.dumps({"source": "startup"}),
                text=True,
                capture_output=True,
                cwd=root,
                env=env,
                check=True,
            )
            compact = subprocess.run(
                [str(compact_hook)],
                text=True,
                capture_output=True,
                cwd=root,
                env=env,
                check=True,
            )
        session_context = json.loads(session.stdout)["hookSpecificOutput"]["additionalContext"]
        compact_context = json.loads(compact.stdout)["systemMessage"]
        for context in (session_context, compact_context):
            self.assertIn("bounded backoff", context)
            self.assertNotIn(captured_secret, context)
        hook_source = session_hook.read_text()
        self.assertNotIn('[ -f "$MEMORY_DIR/USER.md" ]', hook_source)
        self.assertNotIn('[ -f "$MEMORY_DIR/MEMORY.md" ]', hook_source)

    @unittest.skipUnless(os.geteuid() == 0, "root broker integration requires root")
    def test_native_hermes_memory_is_mediated_and_injection_fails_closed(self):
        captured_secret = "example-captured-value"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hermes_home = root / ".hermes"
            memories = hermes_home / "memories"
            memories.mkdir(parents=True)
            broker_socket = root / "run/chillspwn-memory/broker.sock"
            # Production installs the helper root-owned. The shared test
            # checkout may be owned by the workspace service account, so use a
            # root-owned launcher while preserving the real helper code.
            trusted_cli = root / "trusted-memory-cli.py"
            trusted_cli.write_text(
                "#!/usr/bin/env python3\n"
                "import runpy, sys\n"
                f"sys.path.insert(0, {str(LEARNER_DIR)!r})\n"
                f"runpy.run_path({str(LEARNER_DIR / 'chillspwn_mem.py')!r}, run_name='__main__')\n"
            )
            trusted_cli.chmod(0o755)
            env = {
                **os.environ,
                "HERMES_HOME": str(hermes_home),
                "HERMES_PYTHON": sys.executable,
                "CHILLSPWN_HERMES_SRC": str(HERMES_SRC),
                "CHILLSPWN_MEM_CLI": str(trusted_cli),
                "CHILLSPWN_MEMORY_GUARD": "required",
                "CHILLSPWN_MEMORY_SOCKET": str(broker_socket),
                "CHILLSPWN_SERVICE_GROUP": grp.getgrgid(os.getgid()).gr_name,
            }
            broker = subprocess.Popen(
                [sys.executable, str(REPO_ROOT / "scripts/chillspwn-memory-broker.py")],
                env=env,
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                for _ in range(100):
                    if broker_socket.exists():
                        break
                    if broker.poll() is not None:
                        self.fail("memory broker exited before creating its socket")
                    time.sleep(0.02)
                self.assertTrue(broker_socket.exists())
                with mock.patch.dict(os.environ, env, clear=False):
                    store = hermes_memory.MemoryStore()
                    store.load_from_disk()

                    direct = store.add("memory", "Direct store write must fail.")
                    self.assertFalse(direct["success"])

                    added = json.loads(hermes_memory.memory_tool(
                        action="add",
                        target="memory",
                        content="Generic provider retries use bounded backoff.",
                        store=store,
                    ))
                    self.assertTrue(added["success"])

                    rejected = hermes_memory.memory_tool(
                        action="add",
                        target="memory",
                        content=f"password was {captured_secret}",
                        store=store,
                    )
                    self.assertNotIn(captured_secret, rejected)
                    self.assertFalse(json.loads(rejected)["success"])

                    replaced = json.loads(hermes_memory.memory_tool(
                        action="replace",
                        target="memory",
                        old_text="bounded backoff",
                        content="Replacement",
                        store=store,
                    ))
                    self.assertFalse(replaced["success"])

                    # A legacy or out-of-band dirty entry stays on disk for
                    # operator review but never enters the native prompt snapshot.
                    memories.joinpath("MEMORY.md").write_text(
                        "Generic provider retries use bounded backoff.\n§\n"
                        f"password was {captured_secret}"
                    )
                    guarded_reader = hermes_memory.MemoryStore()
                    guarded_reader.load_from_disk()
                    prompt = guarded_reader.format_for_system_prompt("memory") or ""
                    self.assertIn("bounded backoff", prompt)
                    self.assertNotIn(captured_secret, prompt)
                    digest = learn.current_memory_digest(log=lambda _message: None)
                    self.assertIn("bounded backoff", digest)
                    self.assertNotIn(captured_secret, digest)

                    # Agent write_file/patch and ACP filesystem shims share this
                    # denylist. The validated helper writes outside those tools.
                    self.assertTrue(is_write_denied(str(memories / "MEMORY.md")))
                    self.assertIsNotNone(
                        get_read_block_error(str(memories / "MEMORY.md"))
                    )
            finally:
                broker.terminate()
                try:
                    broker.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    broker.kill()
                    broker.wait(timeout=5)

            disk = memories.joinpath("MEMORY.md").read_text()
            self.assertIn(captured_secret, disk)
            self.assertNotIn(captured_secret, memories.joinpath("audit.log").read_text())
            with mock.patch.dict(os.environ, env, clear=False):
                unavailable_reader = hermes_memory.MemoryStore()
                unavailable_reader.load_from_disk()
                self.assertIsNone(unavailable_reader.format_for_system_prompt("memory"))
                failed_write = json.loads(hermes_memory.memory_tool(
                    action="add",
                    target="memory",
                    content="A broker outage must not fall back to direct writes.",
                    store=unavailable_reader,
                ))
                self.assertFalse(failed_write["success"])
            self.assertEqual(memories.joinpath("MEMORY.md").read_text(), disk)

    def test_whole_plan_preflight_writes_nothing_on_one_rejection(self):
        plan = {
            "memory": [{"target": "memory", "text": "A generic provider fact."}],
            "skills": [{
                "action": "create",
                "name": "incomplete-chain",
                "description": "Incomplete chain",
                "content": "## Command Templates\n`tool <TARGET_HOST>`",
            }],
        }
        with mock.patch.object(learn, "_cli") as cli:
            saved = learn.persist(plan, lambda _message: None)
        cli.assert_not_called()
        self.assertEqual(saved["rejected"], 1)
        self.assertEqual(saved["memory"], 0)
        self.assertEqual(saved["skills"], 0)

    def test_reviewed_skill_patch_rejection_precedes_all_writes(self):
        plan = {
            "memory": [{"target": "memory", "text": "A generic provider fact."}],
            "skills": [{
                "action": "patch",
                "name": "reviewed-skill",
                "content": "## Failure Recovery\n- Add a generic bounded retry.",
            }],
        }
        calls = []

        def fake_cli(argv, _log):
            calls.append(argv)
            if "preflight" in argv:
                return False, json.dumps({
                    "success": False,
                    "violations": ["reviewed skill is immutable"],
                })
            self.fail("a persistence write occurred after failed whole-plan preflight")

        with mock.patch.object(learn, "_cli", side_effect=fake_cli):
            saved = learn.persist(plan, lambda _message: None)
        self.assertEqual(len(calls), 1)
        self.assertIn("preflight", calls[0])
        self.assertEqual(saved["rejected"], 1)
        self.assertEqual(saved["memory"], 0)

    def test_direct_skill_cli_validation_cannot_bypass_policy(self):
        self.assertEqual(
            skill_cli.validate_skill_write(
                "create",
                "generalized-service-chain",
                "Reusable service chain",
                VALID_PLAYBOOK,
            ),
            [],
        )
        problems = skill_cli.validate_skill_write(
            "patch",
            "generalized-service-chain",
            content="Run curl https://service.example.org as username=exampleuser",
        )
        self.assertIn("literal URL outside References", problems)
        self.assertIn("target username", problems)

        with mock.patch.object(skill_cli, "_dispatch") as dispatch, mock.patch.object(
            sys,
            "argv",
            [
                "chillspwn_skill.py",
                "patch",
                "--name",
                "generalized-service-chain",
                "--content",
                "target ExampleNode",
            ],
        ), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as stopped:
                skill_cli.main()
        self.assertEqual(stopped.exception.code, 1)
        dispatch.assert_not_called()

    def test_direct_skill_patch_requires_background_review_provenance(self):
        with mock.patch.object(skill_cli, "_dispatch") as dispatch, mock.patch.object(
            skill_cli,
            "is_reviewer_managed_skill",
            return_value=False,
        ), mock.patch.object(
            sys,
            "argv",
            [
                "chillspwn_skill.py",
                "patch",
                "--name",
                "reviewed-skill",
                "--content",
                "## Failure Recovery\n- Add a generic bounded retry.",
            ],
        ), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as stopped:
                skill_cli.main()
        self.assertEqual(stopped.exception.code, 1)
        dispatch.assert_not_called()

    def test_skill_preflight_resolves_only_service_owned_retry_to_patch(self):
        with mock.patch.object(
            skill_cli,
            "find_skill_path",
            return_value=Path("/service-owned/learned-skill"),
        ), mock.patch.object(
            skill_cli,
            "is_reviewer_managed_skill",
            return_value=True,
        ):
            result = skill_cli.preflight_skill_write(
                "create",
                "generalized-service-chain",
                "Reusable service chain",
                VALID_PLAYBOOK,
            )
        self.assertTrue(result["success"])
        self.assertEqual(result["resolved_action"], "patch")

        with mock.patch.object(
            skill_cli,
            "find_skill_path",
            return_value=Path("/root-owned/reviewed-skill"),
        ), mock.patch.object(
            skill_cli,
            "is_reviewer_managed_skill",
            return_value=False,
        ):
            blocked = skill_cli.preflight_skill_write(
                "patch",
                "reviewed-skill",
                content="## Failure Recovery\n- Add a generic bounded retry.",
            )
        self.assertFalse(blocked["success"])
        self.assertIn("reviewed skill is immutable", blocked["violations"])

    def test_learned_skill_create_is_top_level_without_category(self):
        with mock.patch.object(
            skill_cli,
            "_dispatch",
            return_value=json.dumps({"success": True}),
        ) as dispatch, mock.patch.object(
            sys,
            "argv",
            [
                "chillspwn_skill.py",
                "create",
                "--name",
                "generalized-service-chain",
                "--description",
                "Reusable service chain",
                "--content",
                VALID_PLAYBOOK,
            ],
        ), redirect_stdout(io.StringIO()):
            skill_cli.main()
        args = dispatch.call_args.args[1]
        self.assertEqual(dispatch.call_args.args[0], "skill_manage")
        self.assertNotIn("category", args)

    def test_success_marker_is_written_for_explicit_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            transcript = Path(temporary) / "finished.md"
            marker = Path(temporary) / "finished.done.json"
            transcript.write_text("finished session")
            with mock.patch.object(learn, "current_memory_digest", return_value=""), mock.patch.object(
                learn,
                "run_claude",
                return_value=(True, "@NOTHING"),
            ), mock.patch.object(
                sys,
                "argv",
                [
                    "chillspwn_learn.py",
                    "--transcript",
                    str(transcript),
                    "--success-marker",
                    str(marker),
                ],
            ), redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as stopped:
                    learn.main()
            self.assertEqual(stopped.exception.code, 0)
            self.assertTrue(json.loads(marker.read_text())["ok"])


class CronStateTests(unittest.TestCase):
    @staticmethod
    def _load_cron(hermes_home, sessions_dir):
        os.environ["HERMES_HOME"] = str(hermes_home)
        os.environ["CHILLSPWN_SESSIONS_DIR"] = str(sessions_dir)
        module_path = REPO_ROOT / "hermes/runtime/scripts/chillspwn_learn_cron.py"
        name = f"chillspwn_learn_cron_test_{time.time_ns()}"
        spec = importlib.util.spec_from_file_location(name, module_path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    def test_offset_advances_only_after_valid_success_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hermes_home = root / "hermes-home"
            sessions_dir = root / "sessions"
            conversations = hermes_home / "conversations"
            reviewer = (
                hermes_home
                / "skills/red-teaming/council-of-ais/scripts/chillspwn_learn.py"
            )
            reviewer.parent.mkdir(parents=True)
            reviewer.write_text("# reviewer placeholder\n")
            conversations.mkdir(parents=True)
            sessions_dir.mkdir(parents=True)

            cwd = root / "engagement"
            cwd.mkdir()
            mcp = cwd / "conversation.mcp"
            mcp.write_text('{"role":"user","content":"one"}\n'
                           '{"role":"assistant","content":"two"}\n')
            name = "20260715_ChillsPwn_s-123.md"
            transcript = conversations / name
            transcript.write_text("finished")
            sessions_dir.joinpath("s-123.json").write_text(json.dumps({
                "cliSessionId": "native-session",
                "cliCwd": str(cwd),
            }))

            cron = self._load_cron(hermes_home, sessions_dir)
            self.assertEqual(cron.STATE.parent, hermes_home / "state/chillspwn-learning")
            self.assertEqual(cron.SUCCESS_DIR.parent, hermes_home / "state/chillspwn-learning")
            self.assertEqual(cron.LEARN_LOG.parent, hermes_home / "logs")
            now = time.time()
            os.utime(transcript, (now - cron.SETTLE_SECONDS - 10,) * 2)
            with mock.patch.object(cron.time, "time", return_value=now), mock.patch.object(
                cron.subprocess,
                "Popen",
            ) as popen, redirect_stdout(io.StringIO()):
                cron.main()
            popen.assert_called_once()
            first = json.loads(cron.STATE.read_text())
            self.assertEqual(first["mcp_offsets"], {})
            self.assertEqual(first["inflight"][name]["mcp_total"], 2)
            self.assertNotIn(name, first["processed"])

            marker = cron.success_marker_for(name)
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(json.dumps({"ok": True}))
            with mock.patch.object(cron.time, "time", return_value=now + 1), redirect_stdout(
                io.StringIO()
            ):
                cron.main()
            final = json.loads(cron.STATE.read_text())
            self.assertIn(name, final["processed"])
            self.assertEqual(final["mcp_offsets"][str(mcp)], 2)
            self.assertNotIn(name, final["inflight"])

    def test_stale_inflight_becomes_retryable_without_advancing_offset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cron = self._load_cron(root / "hermes-home", root / "sessions")
            cron.SUCCESS_DIR = root / "markers"
            done = set()
            offsets = {"conversation.mcp": 3}
            inflight = {
                "finished.md": {
                    "dispatched_at": 100,
                    "attempt": 1,
                    "mcp_key": "conversation.mcp",
                    "mcp_total": 8,
                }
            }
            changed = cron.reconcile_inflight(
                done,
                offsets,
                inflight,
                100 + cron.RETRY_GRACE_SECONDS + 1,
            )
            self.assertTrue(changed)
            self.assertTrue(inflight["finished.md"]["retry_ready"])
            self.assertEqual(offsets["conversation.mcp"], 3)
            self.assertEqual(done, set())


class CommanderBoundaryTests(unittest.TestCase):
    def test_no_hands_block_covers_mutation_and_private_delegation(self):
        path = LEARNER_DIR / "orchestrator_openrouter.py"
        tree = ast.parse(path.read_text())
        block = None
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "_COMMANDER_BLOCK"
                for target in node.targets
            ):
                block = ast.literal_eval(node.value)
                break
        self.assertIsNotNone(block)
        self.assertTrue({
            "terminal", "execute", "process", "mcp_execute", "write_file", "patch",
            "delegate_task", "remember", "skill_manage", "web_search", "web_extract",
        }.issubset(block))
        source = path.read_text()
        self.assertNotIn('or delegate_task(targetAgentId=', source)
        self.assertIn("Mission Board", source)


class MemoryBrokerUnitTests(unittest.TestCase):
    @staticmethod
    def _load_broker():
        module_path = REPO_ROOT / "scripts/chillspwn-memory-broker.py"
        name = f"chillspwn_memory_broker_test_{time.time_ns()}"
        spec = importlib.util.spec_from_file_location(name, module_path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    def test_broker_allows_only_validated_add_and_safe_read(self):
        broker_module = self._load_broker()
        broker = broker_module.MemoryBroker.__new__(broker_module.MemoryBroker)
        broker._run = mock.Mock(return_value={"ok": True})

        blocked = broker.dispatch(1001, {
            "action": "replace",
            "target": "memory",
            "content": "replacement",
        })
        self.assertFalse(blocked["ok"])
        broker._run.assert_not_called()

        secret_free_entry = "Generic provider retries use bounded backoff."
        added = broker.dispatch(1001, {
            "action": "add",
            "target": "memory",
            "content": secret_free_entry,
        })
        self.assertTrue(added["ok"])
        args, stdin_content = broker._run.call_args.args
        self.assertNotIn(secret_free_entry, args)
        self.assertEqual(stdin_content, secret_free_entry)
        self.assertIn("--stdin", args)

        broker._run.reset_mock()
        read = broker.dispatch(1001, {
            "action": "safe-read",
            "target": "user",
        })
        self.assertTrue(read["ok"])
        read_args = broker._run.call_args.args[0]
        self.assertEqual(read_args[:3], ["safe-read", "--target", "user"])

    def test_broker_rejects_untrusted_executable(self):
        broker_module = self._load_broker()
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "helper"
            executable.write_text("#!/bin/sh\nexit 0\n")
            executable.chmod(0o777)
            with self.assertRaises(RuntimeError):
                broker_module._trusted_executable(str(executable), "helper")


class CouncilRoutingTests(unittest.TestCase):
    @staticmethod
    def _sentinel_council_env(home):
        return {
            "HOME": str(home),
            "PATH": os.defpath,
            "HERMES_PYTHON": sys.executable,
            "HERMES_HOME": "/auth/shared-hermes",
            "COUNCIL_CODEX_HERMES_HOME": "/auth/codex-hermes",
            "COUNCIL_XAI_HERMES_HOME": "/auth/xai-hermes",
            "CODEX_HOME": "/auth/codex-cli",
            "CLAUDE_CONFIG_DIR": "/auth/claude",
            "CLAUDE_CODE_OAUTH_TOKEN": "sentinel-claude-oauth",
            "COUNCIL_CLAUDE_USER": "council-claude",
            "COUNCIL_CLAUDE_HOME": "/home/council-claude",
            "CHILLSPWN_HERMES_SRC": str(HERMES_SRC),
            "CHILLSPWN_MEMORY_GUARD": "required",
            "CHILLSPWN_MEM_CLI": "/trusted/chillspwn_mem.py",
            "CHILLSPWN_MEMORY_SOCKET": "/run/chillspwn-memory/broker.sock",
            "FIRECRAWL_API_KEY": "sentinel-firecrawl",
            "OPENROUTER_API_KEY": "sentinel-openrouter",
            "ANTHROPIC_API_KEY": "sentinel-anthropic",
            "ANTHROPIC_AUTH_TOKEN": "sentinel-anthropic-auth",
            "ANTHROPIC_TOKEN": "sentinel-anthropic-token",
            "OPENAI_API_KEY": "sentinel-openai",
            "XAI_API_KEY": "sentinel-xai",
            "GEMINI_API_KEY": "sentinel-gemini",
            "DASHBOARD_TOKEN": "sentinel-dashboard",
            "TELEGRAM_BOT_TOKEN": "sentinel-telegram",
            "GITHUB_TOKEN": "sentinel-github",
            "AWS_SECRET_ACCESS_KEY": "sentinel-aws",
            "SSH_AUTH_SOCK": "/run/sentinel-agent.sock",
        }

    def test_council_lane_environments_are_provider_scoped(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = self._sentinel_council_env(temporary)
            members = {member["id"]: member for member in council_summon.COUNCIL_MEMBERS}
            lane_envs = {
                member_id: council_summon.build_lane_environment(
                    member,
                    source_env=source,
                    file_env={},
                )
                for member_id, member in members.items()
            }

        forbidden_everywhere = {
            "DASHBOARD_TOKEN",
            "TELEGRAM_BOT_TOKEN",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "SSH_AUTH_SOCK",
            "OPENAI_API_KEY",
            "XAI_API_KEY",
            "GEMINI_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_TOKEN",
        }
        for lane_id, lane_env in lane_envs.items():
            self.assertTrue(
                forbidden_everywhere.isdisjoint(lane_env),
                f"{lane_id} inherited forbidden variables: "
                f"{sorted(forbidden_everywhere.intersection(lane_env))}",
            )
            self.assertEqual(lane_env["CHILLSPWN_MEMORY_GUARD"], "required")

        for lane_id in ("deepseek_v4", "qwen", "glm"):
            self.assertEqual(
                lane_envs[lane_id]["OPENROUTER_API_KEY"],
                "sentinel-openrouter",
            )
            self.assertEqual(
                lane_envs[lane_id]["FIRECRAWL_API_KEY"],
                "sentinel-firecrawl",
            )
            self.assertNotIn("ANTHROPIC_API_KEY", lane_envs[lane_id])
            self.assertNotIn("HERMES_HOME", lane_envs[lane_id])

        claude_env = lane_envs["claude_opus"]
        self.assertEqual(claude_env["CLAUDE_CONFIG_DIR"], "/auth/claude")
        self.assertEqual(
            claude_env["CLAUDE_CODE_OAUTH_TOKEN"],
            "sentinel-claude-oauth",
        )
        self.assertNotIn("ANTHROPIC_API_KEY", claude_env)
        self.assertNotIn("OPENROUTER_API_KEY", claude_env)
        self.assertNotIn("FIRECRAWL_API_KEY", claude_env)

        codex_env = lane_envs["gpt55"]
        self.assertEqual(codex_env["HERMES_HOME"], "/auth/codex-hermes")
        self.assertEqual(codex_env["CODEX_HOME"], "/auth/codex-cli")
        self.assertNotIn("OPENROUTER_API_KEY", codex_env)
        self.assertNotIn("FIRECRAWL_API_KEY", codex_env)
        self.assertNotIn("CHILLSPWN_HERMES_SRC", codex_env)

        grok_env = lane_envs["grok"]
        self.assertEqual(grok_env["HERMES_HOME"], "/auth/xai-hermes")
        self.assertNotIn("CODEX_HOME", grok_env)
        self.assertNotIn("OPENROUTER_API_KEY", grok_env)
        self.assertNotIn("FIRECRAWL_API_KEY", grok_env)
        self.assertNotIn("CHILLSPWN_HERMES_SRC", grok_env)

    def test_lane_env_file_is_selectively_imported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hermes_dir = root / ".hermes"
            hermes_dir.mkdir()
            (hermes_dir / ".env").write_text(
                "OPENROUTER_API_KEY=stored-openrouter\n"
                "DASHBOARD_TOKEN=stored-dashboard\n"
                "XAI_API_KEY=stored-xai\n"
            )
            member = next(
                item for item in council_summon.COUNCIL_MEMBERS
                if item["id"] == "deepseek_v4"
            )
            lane_env = council_summon.build_lane_environment(
                member,
                source_env={
                    "HOME": str(root),
                    "PATH": os.defpath,
                    "CHILLSPWN_HERMES_SRC": str(HERMES_SRC),
                },
            )
        self.assertEqual(lane_env["OPENROUTER_API_KEY"], "stored-openrouter")
        self.assertNotIn("DASHBOARD_TOKEN", lane_env)
        self.assertNotIn("XAI_API_KEY", lane_env)

    def test_spawn_agent_passes_only_the_scoped_lane_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self._sentinel_council_env(root)
            member = next(
                item for item in council_summon.COUNCIL_MEMBERS
                if item["id"] == "deepseek_v4"
            )
            fake_process = object()
            with mock.patch.dict(os.environ, source, clear=True), mock.patch.object(
                council_summon.subprocess,
                "Popen",
                return_value=fake_process,
            ) as popen:
                process = council_summon.spawn_agent(
                    member,
                    "prompt",
                    root,
                    root / "lane.log",
                    briefing="briefing",
                    output_file=root / "assessment.md",
                )
            child_env = popen.call_args.kwargs["env"]

        self.assertIs(process, fake_process)
        self.assertEqual(child_env["OPENROUTER_API_KEY"], "sentinel-openrouter")
        self.assertNotIn("DASHBOARD_TOKEN", child_env)
        self.assertNotIn("ANTHROPIC_API_KEY", child_env)
        self.assertNotIn("XAI_API_KEY", child_env)

    def test_claude_cli_defense_in_depth_strips_unrelated_secrets(self):
        import council_lane_agent as lane_agent

        captured = {}

        class FinishedProcess:
            returncode = 0

            def poll(self):
                return 0

        def fake_popen(*args, **kwargs):
            captured["env"] = dict(kwargs["env"])
            return FinishedProcess()

        with tempfile.TemporaryDirectory() as temporary:
            source = self._sentinel_council_env(temporary)
            with mock.patch.object(lane_agent.subprocess, "Popen", side_effect=fake_popen):
                lane_agent.run_claude_cli(
                    "claude-opus-test",
                    "system",
                    "user",
                    "task",
                    lambda _message: None,
                    live_tools=False,
                    subprocess_env=source,
                )

        child_env = captured["env"]
        self.assertEqual(child_env["CLAUDE_CONFIG_DIR"], "/auth/claude")
        self.assertEqual(
            child_env["CLAUDE_CODE_OAUTH_TOKEN"],
            "sentinel-claude-oauth",
        )
        for name in (
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_TOKEN",
            "OPENROUTER_API_KEY",
            "OPENAI_API_KEY",
            "XAI_API_KEY",
            "GEMINI_API_KEY",
            "DASHBOARD_TOKEN",
            "TELEGRAM_BOT_TOKEN",
            "FIRECRAWL_API_KEY",
        ):
            self.assertNotIn(name, child_env)

    def test_lane_worker_never_reopens_the_parent_env_file(self):
        import council_lane_agent as lane_agent

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hermes_dir = root / ".hermes"
            hermes_dir.mkdir()
            (hermes_dir / ".env").write_text(
                "OPENROUTER_API_KEY=must-not-be-recovered\n"
            )
            with mock.patch.dict(
                os.environ,
                {"HOME": str(root)},
                clear=True,
            ):
                self.assertEqual(lane_agent.load_key("OPENROUTER_API_KEY"), "")

    def test_live_oauth_turn_uses_the_same_scoped_environment(self):
        import council_conversation as conversation

        captured = {}

        class FinishedProcess:
            pid = 12345

            def wait(self, timeout=None):
                return 0

        def fake_popen(*args, **kwargs):
            captured["env"] = dict(kwargs["env"])
            return FinishedProcess()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self._sentinel_council_env(root)
            grok = next(
                item for item in council_summon.COUNCIL_MEMBERS
                if item["id"] == "grok"
            )
            with mock.patch.dict(os.environ, source, clear=True), mock.patch.object(
                conversation,
                "resolve_hermes_cli",
                return_value="/trusted/hermes",
            ), mock.patch.object(subprocess, "Popen", side_effect=fake_popen):
                result = conversation.speak_hermes(
                    grok,
                    "system",
                    "user",
                    root,
                    root / "turn.md",
                    10,
                    lambda _message: None,
                )

        self.assertIsNone(result)
        child_env = captured["env"]
        self.assertEqual(child_env["HERMES_HOME"], "/auth/xai-hermes")
        self.assertNotIn("CODEX_HOME", child_env)
        self.assertNotIn("OPENROUTER_API_KEY", child_env)
        self.assertNotIn("XAI_API_KEY", child_env)
        self.assertNotIn("DASHBOARD_TOKEN", child_env)

    def test_grok_council_lane_is_native_oauth_only(self):
        path = LEARNER_DIR / "council_summon.py"
        tree = ast.parse(path.read_text())
        members = None
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "COUNCIL_MEMBERS"
                for target in node.targets
            ):
                members = ast.literal_eval(node.value)
                break
        self.assertIsNotNone(members)
        grok = next(member for member in members if member["id"] == "grok")
        self.assertEqual(grok["provider"], "xai-oauth")
        self.assertEqual(grok["model"], "grok-4.20-reasoning")
        self.assertNotIn("mode", grok)

    def test_alias_wrappers_are_optional_and_native_commands_remain_valid(self):
        template = (LEARNER_DIR.parent / "templates/council_prompt.md").read_text()
        lane_source = (LEARNER_DIR / "council_lane_agent.py").read_text()
        self.assertIn("{{ALIAS_GUIDANCE}}", template)
        self.assertNotIn("ALIAS NAMES ARE THE ONLY NAMES", template)
        self.assertIn("Native Kali command names are valid", lane_source)
        self.assertNotIn("raw tool names DO NOT EXIST", lane_source)

    def test_lane_commands_use_validated_configured_executables(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            python_exe = root / "python"
            hermes_exe = root / "hermes"
            python_exe.write_text("#!/bin/sh\nexit 0\n")
            hermes_exe.write_text("#!/bin/sh\nexit 0\n")
            python_exe.chmod(0o755)
            hermes_exe.chmod(0o755)
            env = {
                "HERMES_PYTHON": str(python_exe),
                "HERMES_CLI": str(hermes_exe),
            }
            direct = next(
                member for member in council_summon.COUNCIL_MEMBERS
                if member.get("mode") == "direct"
            )
            grok = next(
                member for member in council_summon.COUNCIL_MEMBERS
                if member["id"] == "grok"
            )
            with mock.patch.dict(os.environ, env, clear=False):
                direct_cmd = council_summon.build_agent_command(
                    direct,
                    "prompt",
                    root,
                    "briefing",
                    root / "direct.md",
                )
                oauth_cmd = council_summon.build_agent_command(
                    grok,
                    "prompt",
                    root,
                    "briefing",
                    root / "grok.md",
                )
            self.assertEqual(direct_cmd[0], str(python_exe.resolve()))
            self.assertEqual(oauth_cmd[0], str(hermes_exe.resolve()))
            self.assertIn("xai-oauth", oauth_cmd)
            self.assertNotIn("openrouter", oauth_cmd)

    def test_missing_configured_executable_fails_before_spawn(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(
            os.environ,
            {"HERMES_CLI": str(Path(temporary) / "missing-hermes")},
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                council_summon.resolve_hermes_cli()


if __name__ == "__main__":
    unittest.main()
