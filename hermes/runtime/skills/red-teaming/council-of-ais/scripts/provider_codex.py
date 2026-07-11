"""CodexProvider — OpenAI Codex (gpt-5.5) via the ChatGPT backend Responses API, reusing the
Hermes rails (the SAME token the operator logs in with via Hermes). Approach (b), lower-level:
we call the VENDORED Hermes adapter's pure functions (message/tool conversion + response
normalization) + a raw `openai` client, instead of standing up Hermes' whole agent runtime.

This module is self-contained and imported ONLY when provider == "openai-codex", so the
OpenRouter/Claude paths are untouched. It exposes the same surface the orchestrator's Provider
interface needs — chat_url / auth_headers / build_body / parse_choice — plus `complete()`, which
runs the full Responses-API request (codex can't be expressed as build_body+http_post).

Token: read from ~/.codex/auth.json (kept fresh by the Codex CLI / Hermes login). If it has been
invalidated server-side, codex returns 401 token_invalidated → re-auth via Hermes.
"""
import json
import os

CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
_HERMES_VENDOR = "/root/.claude/chillspwn/vendor/hermes"
DEFAULT_CODEX_MODEL = "gpt-5.5"

# Bound every codex HTTP op so a stalled / half-closed stream can't wedge a turn forever. The shared
# loop self-binds the model API like the OpenRouter path (HTTP_TIMEOUT=300); codex had NO timeout, so
# a mid-stream stall (the chatgpt backend dropping/half-closing the body) sat in poll() indefinitely
# and the UI froze on "Compacting context…". HTTP_TIMEOUT = max gap between streamed chunks (generous
# for gpt-5.x reasoning latency, short of an infinite hang). CALL_MAX = wall-clock backstop for the
# pathological keep-alive-only stream that emits pings forever but never real content / never errors.
# Both are env-overridable so the operator can tune without editing code.
CODEX_HTTP_TIMEOUT = float(os.environ.get("CHILLSPWN_CODEX_HTTP_TIMEOUT", "180") or 180)
CODEX_CALL_MAX_SECONDS = float(os.environ.get("CHILLSPWN_CODEX_CALL_MAX_SECONDS", "600") or 600)


def _acct_from_jwt(access_token: str) -> str:
    """Pull chatgpt_account_id out of the access-token JWT (the canonical source — matches what
    _codex_cloudflare_headers does)."""
    try:
        import base64
        p = access_token.split(".")[1]
        p += "=" * (-len(p) % 4)
        claims = json.loads(base64.urlsafe_b64decode(p))
        return ((claims.get("https://api.openai.com/auth") or {}).get("chatgpt_account_id")) or ""
    except Exception:
        return ""


def _codex_auth():
    """Return (access_token, account_id). PRIMARY source = the Hermes credential_pool in
    /root/.hermes/auth.json — that is the store Hermes writes/refreshes on login, and the
    FRESHEST entry (by last_refresh) is the valid one (the single-use refresh chain means older
    copies, incl. ~/.codex/auth.json, get server-side invalidated). Falls back to the Codex CLI
    store, then the legacy providers block."""
    # 1) Hermes credential_pool — freshest openai-codex entry wins
    try:
        d = json.load(open("/root/.hermes/auth.json"))
        pool = (d.get("credential_pool") or {}).get("openai-codex") or []
        entries = [e for e in pool if isinstance(e, dict) and e.get("access_token")]
        entries.sort(key=lambda e: e.get("last_refresh") or "", reverse=True)
        if entries:
            at = entries[0]["access_token"]
            return at, _acct_from_jwt(at)
    except Exception:
        pass
    # 2) Codex CLI store
    for path in ("/root/.codex/auth.json", os.path.expanduser("~/.codex/auth.json")):
        try:
            d = json.load(open(path))
            tk = d.get("tokens") or {}
            at = tk.get("access_token")
            if at:
                return at, (tk.get("account_id") or _acct_from_jwt(at))
        except Exception:
            continue
    raise RuntimeError("No codex access_token found. Log in to codex via Hermes.")


class CodexProvider:
    """Duck-typed to the orchestrator's Provider interface (no inheritance → no circular import)."""
    name = "codex"
    chat_url = CODEX_BASE_URL
    models_url = ""          # codex has no /models list endpoint we use
    # gpt-5.x context window. The loop's get_context_window() can't query a /models
    # endpoint for codex, so without this it falls back to DEFAULT_WINDOW=128k and the
    # compaction budget (0.60×) collapses to ~77k — far below codex's real capacity —
    # which drove a runaway distill-compact loop. Honored by get_context_window().
    context_window = 400000

    def __init__(self, model=None):
        self.model = (model or DEFAULT_CODEX_MODEL)
        self._client = None

    # ---- Provider interface parity (used by the shared loop) ----
    def auth_headers(self) -> dict:
        # codex auth rides on the openai client (api_key + cloudflare headers); the loop's
        # get_context_window uses this only for a models GET, which codex doesn't support.
        at, _ = _codex_auth()
        return {"Authorization": f"Bearer {at}"}

    def build_body(self, model, messages, *, tools=None, stream=False, response_format=None,
                   max_tokens=None, temperature=None) -> dict:
        # Carry the call params; complete() does the real Responses-API translation.
        return {"model": model, "messages": messages, "tools": tools, "stream": stream,
                "max_tokens": max_tokens, "temperature": temperature}

    def parse_choice(self, j) -> tuple:
        choice = (j.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        return (msg.get("content") or "", msg.get("tool_calls") or [],
                choice.get("finish_reason"), j.get("model"))

    # ---- the codex execution path ----
    def _get_client(self):
        if self._client is None:
            import sys
            if _HERMES_VENDOR not in sys.path:
                sys.path.insert(0, _HERMES_VENDOR)
            import openai  # noqa
            from agent.auxiliary_client import _codex_cloudflare_headers  # noqa
            at, _ = _codex_auth()
            self._client = openai.OpenAI(base_url=CODEX_BASE_URL, api_key=at,
                                         default_headers=_codex_cloudflare_headers(at),
                                         timeout=CODEX_HTTP_TIMEOUT, max_retries=2)
        return self._client

    def complete(self, model, messages, *, tools=None, stream=False, on_text=None,
                 response_format=None, max_tokens=None, temperature=None) -> dict:
        """Run one codex turn and return a CHAT-COMPLETIONS-shaped response dict, so the
        orchestrator loop's parse_choice / Path-A logic is identical to the OpenRouter path."""
        import sys
        if _HERMES_VENDOR not in sys.path:
            sys.path.insert(0, _HERMES_VENDOR)
        from agent.codex_responses_adapter import (
            _chat_messages_to_responses_input, _responses_tools,
            _normalize_codex_response, _preflight_codex_api_kwargs)

        # Codex wants the system prompt as `instructions`, the rest as `input` items.
        instructions = "\n\n".join(
            (m.get("content") or "") for m in messages if m.get("role") == "system" and isinstance(m.get("content"), str))
        convo = [m for m in messages if m.get("role") != "system"]
        api_kwargs = {
            "model": (model or self.model),
            "instructions": instructions,
            "input": _chat_messages_to_responses_input(convo),
            "store": False,
        }
        rtools = _responses_tools(tools)
        if rtools:
            api_kwargs["tools"] = rtools
            api_kwargs["tool_choice"] = "auto"
        # NB: the ChatGPT codex backend REJECTS max_output_tokens ("Unsupported parameter") — it
        # manages its own output cap. So max_tokens is intentionally NOT forwarded for codex.
        api_kwargs = _preflight_codex_api_kwargs(api_kwargs)

        # Reasoning effort ("intelligence"): _preflight rebuilds api_kwargs from a key whitelist
        # that DROPS `reasoning`, so inject it AFTER. Default xhigh (operator: "pro" == max);
        # override per-deploy via CODEX_REASONING_EFFORT, or set it to "none" to disable.
        _effort = (os.environ.get("CODEX_REASONING_EFFORT") or "xhigh").strip().lower()
        if _effort and _effort != "none":
            api_kwargs["reasoning"] = {"effort": _effort}

        # The codex backend REQUIRES streaming ("Stream must be set to true"), so use the SDK's
        # responses.stream() helper (it sets stream=true internally), emit text deltas live via
        # on_text, and — mirroring Hermes' run_codex_stream — collect the streamed output items,
        # because the ChatGPT codex backend streams valid items that get_final_response() returns
        # as an EMPTY output list. Backfill from the collected items (or synthesize from the text
        # deltas) before normalizing, else _normalize_codex_response raises "no output items".
        from types import SimpleNamespace
        import time as _time
        client = self._get_client()
        text_parts, collected_items, has_tool_calls = [], [], False
        _deadline = _time.time() + CODEX_CALL_MAX_SECONDS
        with client.responses.stream(**api_kwargs) as stream:
            for event in stream:
                if _time.time() > _deadline:
                    # Wall-clock backstop: a stream that keeps the socket alive (pings) but never
                    # finishes would dodge the per-read HTTP timeout — abort so the turn can't wedge.
                    raise TimeoutError(
                        f"codex stream exceeded {CODEX_CALL_MAX_SECONDS:.0f}s wall-clock cap")
                et = getattr(event, "type", "")
                if "output_text.delta" in et:
                    delta = getattr(event, "delta", "") or ""
                    if delta:
                        text_parts.append(delta)
                        if on_text and not has_tool_calls:
                            on_text(delta)
                elif "function_call" in et:
                    has_tool_calls = True
                elif et == "response.output_item.done":
                    item = getattr(event, "item", None)
                    if item is not None:
                        collected_items.append(item)
            resp = stream.get_final_response()
        _out = getattr(resp, "output", None)
        if isinstance(_out, list) and not _out:
            if collected_items:
                resp.output = list(collected_items)
            elif text_parts and not has_tool_calls:
                resp.output = [SimpleNamespace(type="message", role="assistant", status="completed",
                    content=[SimpleNamespace(type="output_text", text="".join(text_parts))])]
        # NB: _normalize_codex_response returns (assistant_message_obj, FINISH_REASON) — the 2nd
        # value is the finish reason ("stop"/"tool_calls"), NOT the text. The text is the streamed
        # deltas (authoritative); tool_calls come off the normalized message object.
        norm, _finish = _normalize_codex_response(resp)

        tcs = []
        for tc in (getattr(norm, "tool_calls", None) or []):
            fn = getattr(tc, "function", None)
            tcs.append({
                "id": getattr(tc, "id", None) or getattr(tc, "call_id", None) or f"call_{len(tcs)}",
                "type": "function",
                "function": {"name": getattr(fn, "name", "") or "",
                             "arguments": getattr(fn, "arguments", "") or "{}"},
            })
        text = "".join(text_parts)
        if not text and not tcs:
            # no streamed deltas (rare) — pull text off the normalized message's content parts
            for c in (getattr(norm, "content", None) or []):
                ctype = getattr(c, "type", None) or (c.get("type") if isinstance(c, dict) else None)
                if ctype in ("output_text", "text"):
                    text += getattr(c, "text", None) or (c.get("text", "") if isinstance(c, dict) else "") or ""
        msg = {"role": "assistant", "content": text or ""}
        if tcs:
            msg["tool_calls"] = tcs
        usage = getattr(resp, "usage", None)
        return {
            "choices": [{"message": msg, "finish_reason": "tool_calls" if tcs else "stop"}],
            "model": getattr(resp, "model", None) or model,
            "usage": {"prompt_tokens": getattr(usage, "input_tokens", 0) or 0,
                      "completion_tokens": getattr(usage, "output_tokens", 0) or 0} if usage else {},
        }
