#!/usr/bin/env python3
"""
council_conversation.py — LIVE Council of AIs (roundtable debate).

Six elite AI hackers hold a REAL-TIME conversation about a stuck engagement.
Unlike the classic council (each model writes a sealed assessment alone), here
they share ONE growing conversation: on each turn a model reads everything said
so far and adds the next message — agreeing, challenging, chaining ideas — then
the next model sees that and replies, cycling for a few laps. Finally a chair
model synthesizes the whole debate into the single final verdict ("the final
ask"). It is genuinely live: every message is written in response to the ones
posted moments earlier, and streamed to Telegram + `conversation.md` as it happens.

Reuse (no logic duplicated):
  • Direct lanes (Claude=anthropic, DeepSeek/Qwen/GLM=openrouter) run IN-PROCESS via
    council_lane_agent.run_anthropic / run_openrouter — the same non-streaming
    agentic tool loop the classic council uses (immune to the mid-stream stall).
  • OAuth lanes (GPT-5.5=openai-codex, Grok=xai-oauth) get one `hermes chat` per
    turn so they ride their subscriptions (no OpenRouter credits), each writing
    ONLY its message to a turn file we read back.
  • Members, Telegram, env, timing come from council_summon; state from council_state.

Usage:
    python3 council_conversation.py \
        --engagement-dir /path/to/authorized-engagement/ \
        --briefing "RCE as www-data, stuck on privesc. Tried SUID/sudo/cron/kernel." \
        --laps 3 --per-turn-timeout 420
"""
import argparse
import os
import sys
import time
import threading
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import council_state                                   # shared global council state
from council_summon import (                            # reuse — single source of truth
    COUNCIL_MEMBERS, build_lane_environment, send_telegram, load_env,
    format_time, resolve_hermes_cli,
)
import council_lane_agent as la                         # reuse the in-process agentic loops

# ── Live-turn tuning ───────────────────────────────────────────────────────
# A conversational turn is SHORT: peek at a couple of files if needed, then speak.
# Openings (lap 1) get a little more room to investigate; later turns lean on the
# shared conversation + evidence already surfaced, so they converge fast.
OPENING_MAX_ITERS = 8
OPENING_FORCE_WRITE_AT = 4
REPLY_MAX_ITERS = 5
REPLY_FORCE_WRITE_AT = 2
CONV_CAP_CHARS = 80_000          # cap of conversation text handed to each speaker
PER_LANE_RENDER_CAP = 6_000      # cap per message when rendering the running transcript
LIVE_HTTP_TIMEOUT = 180          # per-request cap for direct lanes during live turns


LIVE_SYSTEM = """You are {name}, one of six elite penetration testers sitting at a LIVE COUNCIL ROUNDTABLE about an engagement where the lead pentester is STUCK. The other five are real, equally-skilled hackers in the room with you, each powered by a different model. You are having an actual conversation — you will read what has been said so far and speak next, then they respond to you.

You have REAL tools (a `terminal`, `read_file`, `search_files`, `execute_code`) and the engagement directory. If a claim in the room needs checking against the evidence (a scan, a cred file, an exploit script), run a FEW tool calls to verify it — then speak.

How to speak in this room:
- RESPOND to the others by name — "GPT's SSTI angle…", "I disagree with DeepSeek, because the nmap output shows…". Do not ignore what was just said.
- Add NEW signal every turn: fresh evidence, a sharper reason, a correction, or a way to CHAIN two people's ideas into a stronger attack. Never just restate your earlier point.
- If someone changed your mind, say so plainly and move the group forward.
- Drive toward ONE concrete plan the council can commit to. Challenge weak/already-tried ideas hard, but concede when you're wrong.
- Be CONCISE and conversational — a focused paragraph or two, like talking, not a written report. No section headers.
- End your message with exactly one line: `MY VOTE: <the single attack vector you'd commit to right now>`

Output ONLY your spoken message. No preamble, no markdown headers, and after any tool calls your final text is what you "say" to the room."""


def build_live_user(briefing, engagement_dir, conversation_text, opening):
    convo = conversation_text.strip() or "(The room is silent — you are the FIRST to speak. Open the discussion with your read of the situation and your best idea.)"
    nudge = ("You are opening the debate — give the room your investigation-backed read and your strongest lead."
             if opening else
             "Read the room and reply — engage the latest messages directly, don't repeat what's settled.")
    return (f"## The stuck engagement\n{briefing}\n\n"
            f"## Engagement directory\n`{engagement_dir}`  (your tools work here — verify a disputed claim before you assert it)\n\n"
            f"## The live council conversation so far\n\n{convo}\n\n"
            f"---\n{nudge}\nAdd your next message to the conversation now.")


# ── Rendering the running conversation ─────────────────────────────────────
def render_conversation(history, cap=CONV_CAP_CHARS):
    """history: list of dicts {emoji, name, lap, text}. Newest-biased if over cap."""
    blocks = []
    for h in history:
        text = h["text"].strip()
        if len(text) > PER_LANE_RENDER_CAP:
            text = text[:PER_LANE_RENDER_CAP] + "\n…[truncated]…"
        blocks.append(f"### {h['emoji']} {h['name']}  (lap {h['lap']})\n\n{text}")
    full = "\n\n".join(blocks)
    if len(full) > cap:
        # Keep the most recent context — the tail of the conversation matters most for a reply.
        full = "…[earlier turns omitted]…\n\n" + full[-cap:]
    return full


# ── One turn ───────────────────────────────────────────────────────────────
def _run_with_timeout(fn, timeout):
    """Run fn() in a daemon thread; return (value, error). On timeout → (None, TimeoutError)."""
    box = {}

    def target():
        try:
            box["v"] = fn()
        except Exception as e:  # noqa: BLE001 — surface any lane error as a skip
            box["e"] = e

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        return None, TimeoutError(f"turn exceeded {timeout}s")
    return box.get("v"), box.get("e")


def speak_direct(member, system, user, task_id, opening, log, engagement_dir=None):
    """In-process turn for claude-cli/anthropic/openrouter lanes via the lane agent's loops."""
    mi = OPENING_MAX_ITERS if opening else REPLY_MAX_ITERS
    fwa = OPENING_FORCE_WRITE_AT if opening else REPLY_FORCE_WRITE_AT
    prov = member.get("provider")
    lane_env = build_lane_environment(member)
    if prov == "claude-cli":
        # `claude -p` on the subscription (see run_claude_cli); investigates the engagement
        # dir live (or uses pre-fed evidence in fallback mode — do_turn inlines it then).
        return la.run_claude_cli(
            member["model"], system, user, task_id, log,
            cwd=engagement_dir, subprocess_env=lane_env,
        )
    if prov == "anthropic":
        return la.run_anthropic(
            member["model"], system, user, task_id, log, max_iters=mi,
            api_key=lane_env.get("ANTHROPIC_API_KEY"),
        )
    return la.run_openrouter(
        member["model"], system, user, task_id, log, max_iters=mi,
        force_write_at=fwa, api_key=lane_env.get("OPENROUTER_API_KEY"),
    )


def speak_hermes(member, system, user, engagement_dir, out_path, per_turn_timeout, log):
    """One `hermes chat` turn for an OAuth lane; it writes ONLY its message to out_path."""
    import subprocess
    try:
        if out_path.exists():
            out_path.unlink()
    except OSError:
        pass
    prompt = (f"{system}\n\n{user}\n\n"
              f"IMPORTANT: Write ONLY your spoken message (the concise paragraph(s) ending with the "
              f"`MY VOTE:` line) to the file `{out_path}` using your file tool. Write nothing else to "
              f"that file, and do not ask questions — just investigate briefly if needed, then write.")
    cmd = [resolve_hermes_cli(), "chat", "-q", prompt, "--model", member["model"],
           "--provider", member.get("provider", "openrouter"), "-t", "file,terminal", "--yolo", "-Q"]
    logf = out_path.with_suffix(".log.txt")
    with open(logf, "w") as lh:
        proc = subprocess.Popen(cmd, stdout=lh, stderr=subprocess.STDOUT, cwd=str(engagement_dir),
                                env=build_lane_environment(member), start_new_session=True,
                                stdin=subprocess.DEVNULL)
    try:
        proc.wait(timeout=per_turn_timeout)
    except subprocess.TimeoutExpired:
        log(f"hermes turn timeout ({per_turn_timeout}s) — killing")
        try:
            import signal
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
    if out_path.exists() and out_path.stat().st_size > 40:
        return out_path.read_text()
    return None


def do_turn(member, briefing, engagement_dir, conversation_text, opening, per_turn_timeout,
            council_dir, turn_no, aliases):
    """Produce this member's next message, or None if it failed/timed out."""
    name = member["display_name"]
    system = LIVE_SYSTEM.format(name=name)
    if aliases:
        system += la.ALIAS_BLOCK.format(aliases=aliases)
    user = build_live_user(briefing, engagement_dir, conversation_text, opening)
    if member.get("provider") == "claude-cli" and not la.CLAUDE_LIVE_TOOLS:
        # Fallback (tool-less) only — inline the engagement evidence it can't read live.
        user = user + "\n\n" + la.curate_engagement_context(engagement_dir, char_budget=120_000)
    task_id = f"council-live-{member['id']}-t{turn_no}"

    def log(m):
        print(f"[{name} · turn {turn_no}] {m}", flush=True)

    if member.get("mode") == "direct":
        # Bound the direct turn's wall clock; the loop itself is short but APIs can stall.
        prev = la.HTTP_TIMEOUT
        la.HTTP_TIMEOUT = LIVE_HTTP_TIMEOUT
        try:
            msg, err = _run_with_timeout(
                lambda: speak_direct(member, system, user, task_id, opening, log,
                                     engagement_dir=engagement_dir), per_turn_timeout)
        finally:
            la.HTTP_TIMEOUT = prev
        if err:
            log(f"error: {err}")
        return (msg or "").strip() or None
    else:
        out_path = council_dir / f"_turn{turn_no:02d}_{member['id']}.md"
        msg = speak_hermes(member, system, user, engagement_dir, out_path, per_turn_timeout, log)
        return (msg or "").strip() or None


# ── Chair synthesis (the final verdict) ────────────────────────────────────
def run_chair(chair, briefing, engagement_dir, full_transcript, council_dir, per_turn_timeout, aliases):
    name = chair["display_name"]
    system = la.CHAIR_TEMPLATE.format(name=name)
    if aliases:
        system += la.ALIAS_BLOCK.format(aliases=aliases)
    user = la.build_user_chair(briefing, engagement_dir, full_transcript)
    if chair.get("provider") == "claude-cli" and not la.CLAUDE_LIVE_TOOLS:
        # Fallback (tool-less) only — inline the engagement evidence it can't read live.
        user = user + "\n\n" + la.curate_engagement_context(engagement_dir, char_budget=120_000)
    task_id = f"council-live-chair-{chair['id']}"

    def log(m):
        print(f"[CHAIR {name}] {m}", flush=True)

    def _chair_runner(model, system, user, task_id, log, max_iters=None):
        prov = chair["provider"]
        lane_env = build_lane_environment(chair)
        if prov == "claude-cli":
            return la.run_claude_cli(
                model, system, user, task_id, log, cwd=engagement_dir,
                subprocess_env=lane_env,
            )
        if prov == "anthropic":
            return la.run_anthropic(
                model, system, user, task_id, log, max_iters=max_iters,
                api_key=lane_env.get("ANTHROPIC_API_KEY"),
            )
        return la.run_openrouter(
            model, system, user, task_id, log, max_iters=max_iters,
            api_key=lane_env.get("OPENROUTER_API_KEY"),
        )

    if chair.get("mode") == "direct":
        prev = la.HTTP_TIMEOUT
        la.HTTP_TIMEOUT = LIVE_HTTP_TIMEOUT
        try:
            verdict, err = _run_with_timeout(
                lambda: _chair_runner(
                    chair["model"], system, user, task_id, log, max_iters=OPENING_MAX_ITERS),
                per_turn_timeout + 180)
        finally:
            la.HTTP_TIMEOUT = prev
        if err:
            log(f"chair error: {err}")
        return (verdict or "").strip() or None
    else:
        out_path = council_dir / "_chair_verdict.md"
        msg = speak_hermes(chair, system, user, engagement_dir, out_path, per_turn_timeout + 180, log)
        return (msg or "").strip() or None


# ── Orchestration ──────────────────────────────────────────────────────────
def run_live(engagement_dir, briefing, laps, per_turn_timeout, chair_id, completion_mode,
             members=None):
    members = members or COUNCIL_MEMBERS
    engagement_dir = Path(engagement_dir).resolve()
    council_dir = engagement_dir / "council"
    council_dir.mkdir(exist_ok=True)
    engagement_name = engagement_dir.name

    env = load_env()
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "") or env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_ALLOWED_USERS", "") or env.get("TELEGRAM_ALLOWED_USERS", "")

    aliases = la.load_aliases()

    # Register in shared council state so the dashboard/agent see this run.
    try:
        council_state.ensure_run(
            engagement_name, engagement_dir, briefing, completion_mode,
            {m["id"]: {"display": m["display_name"], "provider": m.get("provider", "openrouter"),
                       "mode": m.get("mode", "hermes")} for m in members})
    except Exception as e:
        print(f"[!] council_state.ensure_run failed (non-fatal): {e}")

    conv_path = council_dir / "conversation.md"
    header = (f"# 🏛️ Council LIVE Debate — {engagement_name}\n\n"
              f"**When**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
              f"**Briefing**: {briefing}\n"
              f"**Participants**: " + ", ".join(f"{m['emoji']} {m['display_name']}" for m in members) + "\n"
              f"**Format**: {laps} lap(s), then {next((m['display_name'] for m in members if m['id']==chair_id), '?')} chairs the verdict.\n\n---\n")
    conv_path.write_text(header)

    print("=" * 60)
    print(f"🏛️  COUNCIL LIVE DEBATE — {engagement_name}  ({laps} laps, {len(members)} members)")
    print("=" * 60)
    if bot_token and chat_id:
        send_telegram(bot_token, chat_id,
                      f"🏛️ *COUNCIL LIVE DEBATE* — `{engagement_name}`\n"
                      f"_{briefing[:180]}_\n\n"
                      f"{len(members)} AI hackers talking it out over {laps} lap(s), then a chair verdict. "
                      f"Watch it live below…")

    history = []       # [{id, emoji, name, lap, text}]
    last_msg = {}      # member id -> latest message (for back-compat assessment files)
    start_mono = time.monotonic()

    for lap in range(1, laps + 1):
        print(f"\n──── LAP {lap}/{laps} ────")
        if bot_token and chat_id:
            send_telegram(bot_token, chat_id, f"🔄 *Lap {lap}/{laps}* — the council speaks…")
        for member in members:
            turn_no = len(history) + 1
            opening = (lap == 1)
            conv_text = render_conversation(history)
            t0 = time.monotonic()
            print(f"  {member['emoji']} {member['display_name']} thinking…")
            msg = do_turn(member, briefing, engagement_dir, conv_text, opening,
                          per_turn_timeout, council_dir, turn_no, aliases)
            dt = format_time(time.monotonic() - t0)
            if msg:
                entry = {"id": member["id"], "emoji": member["emoji"],
                         "name": member["display_name"], "lap": lap, "text": msg}
                history.append(entry)
                last_msg[member["id"]] = msg
                # Append to the live transcript file immediately.
                with open(conv_path, "a") as f:
                    f.write(f"\n### {member['emoji']} {member['display_name']}  ·  lap {lap}  ·  {dt}\n\n{msg}\n\n---\n")
                try:
                    council_state.update_lane(engagement_name, member["id"],
                                              status="submitted", assessment_bytes=len(msg))
                except Exception:
                    pass
                # Pull out the vote line for a compact Telegram beat.
                vote = ""
                for ln in msg.splitlines():
                    if ln.strip().upper().startswith("MY VOTE"):
                        vote = ln.strip()
                        break
                snippet = (msg[:220] + "…") if len(msg) > 220 else msg
                print(f"  {member['emoji']} {member['display_name']} spoke ({len(msg)}b, {dt}). {vote}")
                if bot_token and chat_id:
                    send_telegram(bot_token, chat_id,
                                  f"{member['emoji']} *{member['display_name']}* · lap {lap}\n{snippet}"
                                  + (f"\n\n🗳️ _{vote}_" if vote else ""))
            else:
                print(f"  {member['emoji']} {member['display_name']} stayed silent (failed/timeout, {dt}).")
                with open(conv_path, "a") as f:
                    f.write(f"\n### {member['emoji']} {member['display_name']}  ·  lap {lap}\n\n_(no response — skipped this turn)_\n\n---\n")
                try:
                    council_state.update_lane(engagement_name, member["id"], status="failed")
                except Exception:
                    pass

    # ── Chair synthesizes the final verdict ──────────────────────────────
    chair = next((m for m in members if m["id"] == chair_id), members[0])
    print(f"\n──── CHAIR: {chair['display_name']} synthesizing final verdict ────")
    if bot_token and chat_id:
        send_telegram(bot_token, chat_id,
                      f"⚖️ *{chair['display_name']}* is weighing the debate and writing the council's final verdict…")
    full_transcript = render_conversation(history, cap=200_000)
    verdict = run_chair(chair, briefing, engagement_dir, full_transcript, council_dir, per_turn_timeout, aliases)

    verdict_path = council_dir / "final_verdict.md"
    if verdict:
        verdict_path.write_text(verdict + f"\n\n---\n_Chaired by {chair['display_name']}. Full debate: `conversation.md`._\n")
    else:
        # Chair failed — leave the raw conversation as the deliverable and say so.
        verdict_path.write_text(
            f"# 🏛️ Council Final Verdict — CHAIR FAILED\n\n"
            f"The chair ({chair['display_name']}) did not return a synthesis. Read the full live debate in "
            f"`conversation.md` and synthesize manually. Each member's latest position is in "
            f"`*_assessment.md`.\n")

    # ── Back-compat: each member's LAST message → {id}_assessment.md ──────
    for member in members:
        if member["id"] in last_msg:
            (council_dir / f"{member['id']}_assessment.md").write_text(
                f"# {member['display_name']} — Final position (live debate)\n\n{last_msg[member['id']]}\n")

    # ── Session summary ──────────────────────────────────────────────────
    elapsed = format_time(time.monotonic() - start_mono)
    (council_dir / "council_summary.md").write_text(
        f"# Council of AIs — LIVE Debate Summary\n\n"
        f"**Date**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"**Engagement**: `{engagement_dir}`\n"
        f"**Briefing**: {briefing}\n"
        f"**Laps**: {laps}  ·  **Turns**: {len(history)}  ·  **Duration**: {elapsed}\n"
        f"**Chair**: {chair['display_name']}\n\n"
        f"## Deliverable\n- 🏛️ Final verdict: `final_verdict.md`\n- 💬 Full live debate: `conversation.md`\n"
        f"- 🗣️ Each member's final position: `*_assessment.md`\n")

    try:
        st = council_state.finish_run(engagement_name)
        final = st.get("runs", {}).get(engagement_name, {}).get("status", "?")
    except Exception:
        final = "?"

    print("\n" + "=" * 60)
    print(f"🏛️  LIVE DEBATE COMPLETE — {len(history)} turns over {laps} laps in {elapsed}")
    print(f"📜 Verdict: {verdict_path}")
    print(f"💬 Transcript: {conv_path}")
    print("=" * 60)
    if bot_token and chat_id:
        head = (verdict.splitlines()[0] if verdict else "See conversation.md")
        # Telegram messages cap ~4096 chars; send the verdict head + a trimmed body.
        body = (verdict or "")[:3200]
        send_telegram(bot_token, chat_id,
                      f"🏛️ *COUNCIL VERDICT IS IN* — `{engagement_name}` ({elapsed}, {len(history)} turns)\n\n{body}")
        if final == "awaiting_review":
            send_telegram(bot_token, chat_id,
                          f"🟡 Council `{engagement_name}` awaiting review — mark it Complete in the dashboard to release ChillsPwn.")

    return {"verdict_path": str(verdict_path), "conversation_path": str(conv_path),
            "turns": len(history), "status": final}


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Council of AIs — LIVE roundtable debate")
    ap.add_argument("--engagement-dir", "-d", required=True)
    ap.add_argument("--briefing", "-b", required=True)
    ap.add_argument("--laps", type=int, default=3,
                    help="How many times each member speaks (default 3). More laps = deeper convergence, more cost/time.")
    ap.add_argument("--per-turn-timeout", type=int, default=420,
                    help="Max seconds for a single member's turn before it's skipped (default 420).")
    ap.add_argument("--chair", default="claude_opus",
                    help="Member id that synthesizes the final verdict (default claude_opus).")
    ap.add_argument("--completion-mode", choices=["auto", "manual"], default=None,
                    help="auto = self-complete (default); manual = sit in awaiting_review until the dashboard marks it complete.")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan without calling any model.")
    args = ap.parse_args()

    engagement_dir = Path(args.engagement_dir).resolve()
    if not engagement_dir.exists():
        print(f"[!] Engagement directory does not exist: {engagement_dir}")
        sys.exit(1)

    completion_mode = args.completion_mode or council_state.get_default_mode()

    if args.dry_run:
        print("[DRY RUN] LIVE council debate plan")
        print(f"  engagement : {engagement_dir}")
        print(f"  laps       : {args.laps}  (each member speaks {args.laps}×)")
        print(f"  turns      : {args.laps * len(COUNCIL_MEMBERS)} member turns + 1 chair")
        print(f"  chair      : {args.chair}")
        print(f"  per-turn   : {args.per_turn_timeout}s")
        print(f"  completion : {completion_mode}")
        print("  speaking order per lap:")
        for i, m in enumerate(COUNCIL_MEMBERS, 1):
            kind = "in-process" if m.get("mode") == "direct" else "hermes-per-turn"
            print(f"    {i}. {m['emoji']} {m['display_name']:16s} [{kind}] {m.get('provider')}:{m['model']}")
        print("[DRY RUN] No models called.")
        sys.exit(0)

    run_live(engagement_dir, args.briefing, args.laps, args.per_turn_timeout,
             args.chair, completion_mode)


if __name__ == "__main__":
    main()
