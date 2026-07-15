"""GeminiProvider — Google Gemini (gemini-3.5-flash, gemini-flash-latest, …) via the NATIVE
generativelanguage v1beta API, with safetySettings=BLOCK_NONE on EVERY request.

WHY native (and not the OpenAI-compat endpoint): the operator requires BLOCK_NONE. The Gemini
OpenAI-compat endpoint (/v1beta/openai/chat/completions) SILENTLY blocks security content (it
returned finishReason/content = null on a benign "ChillsPwn online" string, 3/3) AND rejects any
safety override (`400 Unknown name "safety_settings"`). Only the native generateContent endpoint
honours an explicit safetySettings=BLOCK_NONE override — verified: it unblocks the same pwn /
reverse-shell content the default filter kills. So this provider speaks the native API and bakes
BLOCK_NONE into the body unconditionally.

This module is self-contained and imported ONLY when provider == "gemini" (see make_provider in
orchestrator_openrouter.py), so the OpenRouter / Codex / Claude paths are untouched. It exposes the
same surface the orchestrator's Provider interface needs — name / chat_url / models_url /
context_window / auth_headers / build_body / parse_choice — plus complete(), which runs one native
turn and returns a CHAT-COMPLETIONS-shaped dict so the shared loop's parse_choice / Path-A logic is
identical to every other provider.

Key: `GEMINI_API_KEY` or `GOOGLE_API_KEY` from the protected process environment. This module
does not inspect user home directories or credential files.
"""
import json
import os
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"

# Generous per-read timeout — gemini-3.5-flash is a thinking model and may spend several seconds
# reasoning before the first token. Env-overridable so the operator can tune without editing code.
GEMINI_HTTP_TIMEOUT = float(os.environ.get("CHILLSPWN_GEMINI_HTTP_TIMEOUT", "300") or 300)

# BLOCK_NONE on every configurable harm category — the entire point of using the native endpoint.
SAFETY_BLOCK_NONE = [
    {"category": c, "threshold": "BLOCK_NONE"} for c in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
        "HARM_CATEGORY_CIVIC_INTEGRITY",
    )
]

# Native finishReason → chat-completions finish_reason.
_MAP_FINISH = {"STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter",
               "RECITATION": "stop", "OTHER": "stop", "BLOCKLIST": "content_filter",
               "PROHIBITED_CONTENT": "content_filter", "SPII": "content_filter"}

# Gemini's Schema is an OpenAPI-3.0 subset and 400s on the JSON-Schema-isms that OpenAI tool
# definitions carry ($schema, additionalProperties, $ref, examples, oneOf/allOf, …). Keep ONLY the
# fields Gemini's Schema accepts; everything else is dropped recursively.
_SCHEMA_KEEP = {"type", "format", "description", "nullable", "enum", "items", "properties",
                "required", "minimum", "maximum", "minItems", "maxItems", "minLength",
                "maxLength", "pattern", "anyOf", "default"}


def _sanitize_schema(s):
    """Recursively strip JSON-Schema fields Gemini's Schema doesn't accept."""
    if not isinstance(s, dict):
        return s
    out = {}
    for k, v in s.items():
        if k not in _SCHEMA_KEEP:
            continue
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _sanitize_schema(pv) for pk, pv in v.items()}
        elif k == "items":
            out[k] = _sanitize_schema(v)
        elif k == "anyOf" and isinstance(v, list):
            out[k] = [_sanitize_schema(x) for x in v]
        else:
            out[k] = v
    return out


def _tools_to_gemini(tools):
    """OpenAI [{type:function, function:{name,description,parameters}}] → Gemini
    [{functionDeclarations:[{name,description,parameters}]}]."""
    if not tools:
        return None
    decls = []
    for t in tools:
        fn = (t or {}).get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        d = {"name": name}
        if fn.get("description"):
            d["description"] = fn["description"]
        params = fn.get("parameters")
        # Gemini accepts a declaration with no parameters; only attach a schema when there's one.
        if isinstance(params, dict) and params.get("properties"):
            d["parameters"] = _sanitize_schema(params)
        decls.append(d)
    return [{"functionDeclarations": decls}] if decls else None


def _messages_to_gemini(messages):
    """OpenAI chat messages → (contents, systemInstruction). All system messages are concatenated
    into a single systemInstruction (Gemini has exactly one); user/assistant/tool become contents
    with role user/model, tool_calls → functionCall parts, tool results → functionResponse parts.
    Consecutive same-role contents are merged (Gemini prefers user/model alternation)."""
    sys_parts = []
    contents = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if role == "system":
            if isinstance(content, str) and content.strip():
                sys_parts.append(content)
            continue
        if role == "user":
            txt = content if isinstance(content, str) else json.dumps(content)
            contents.append({"role": "user", "parts": [{"text": txt or ""}]})
        elif role == "assistant":
            parts = []
            if isinstance(content, str) and content.strip():
                parts.append({"text": content})
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                fcpart = {"functionCall": {"name": fn.get("name") or "tool", "args": args}}
                # Echo the thought signature back so Gemini-3 thinking + multi-step function
                # calling stays valid (the API can reject a follow-up turn whose prior
                # functionCall dropped its signature). Captured in _gemini_to_chat.
                sig = tc.get("_gemini_thought_signature")
                if sig:
                    fcpart["thoughtSignature"] = sig
                parts.append(fcpart)
            if not parts:
                parts.append({"text": content if isinstance(content, str) else ""})
            contents.append({"role": "model", "parts": parts})
        elif role == "tool":
            name = m.get("name") or "tool"
            resp = content if isinstance(content, str) else json.dumps(content)
            contents.append({"role": "user", "parts": [
                {"functionResponse": {"name": name, "response": {"result": resp}}}]})
        else:
            if content:
                contents.append({"role": "user", "parts": [{"text": str(content)}]})

    # Merge consecutive same-role contents (e.g. a user text msg followed by a functionResponse,
    # both role "user") so the request keeps clean user/model alternation.
    merged = []
    for c in contents:
        if merged and merged[-1]["role"] == c["role"]:
            merged[-1]["parts"].extend(c["parts"])
        else:
            merged.append({"role": c["role"], "parts": list(c["parts"])})

    sys_inst = {"parts": [{"text": "\n\n".join(sys_parts)}]} if sys_parts else None
    return merged, sys_inst


def _build_request(model, messages, tools, max_tokens, temperature):
    """Construct the native generateContent body — safetySettings=BLOCK_NONE always present."""
    contents, sys_inst = _messages_to_gemini(messages)
    body = {"contents": contents, "safetySettings": SAFETY_BLOCK_NONE}
    if sys_inst:
        body["systemInstruction"] = sys_inst
    gt = _tools_to_gemini(tools)
    if gt:
        body["tools"] = gt
    gen = {}
    if max_tokens:
        gen["maxOutputTokens"] = int(max_tokens)
    if temperature is not None:
        gen["temperature"] = float(temperature)
    if gen:
        body["generationConfig"] = gen
    return body


def _gemini_to_chat(resp, model):
    """Native generateContent response → chat-completions-shaped dict. Skips internal thinking
    parts; functionCall parts become OpenAI tool_calls (with the thought signature stashed for the
    next turn); usage includes thinking tokens so the loop's budget stays correct."""
    cands = resp.get("candidates") or []
    text = ""
    tcs = []
    finish = "stop"
    if cands:
        cand = cands[0]
        finish_raw = cand.get("finishReason") or "STOP"
        for part in ((cand.get("content") or {}).get("parts") or []):
            if part.get("thought"):
                continue  # internal reasoning summary — never surfaced to the loop/UI
            if "functionCall" in part:
                fc = part["functionCall"] or {}
                tc = {"id": "call_" + uuid.uuid4().hex[:8], "type": "function",
                      "function": {"name": fc.get("name") or "tool",
                                   "arguments": json.dumps(fc.get("args") or {})}}
                if part.get("thoughtSignature"):
                    tc["_gemini_thought_signature"] = part["thoughtSignature"]
                tcs.append(tc)
            elif "text" in part:
                text += part.get("text") or ""
        if tcs:
            finish = "tool_calls"
        else:
            finish = _MAP_FINISH.get(finish_raw, "stop")
            if finish == "content_filter" and not text:
                # BLOCK_NONE covers the configurable categories; the non-configurable core policy
                # filter can still fire. Surface it instead of returning a confusing silent blank.
                text = (f"[gemini: output blocked by core policy filter "
                        f"(finishReason={finish_raw}); not overridable by BLOCK_NONE]")
    msg = {"role": "assistant", "content": text}
    if tcs:
        msg["tool_calls"] = tcs
    um = resp.get("usageMetadata") or {}
    usage = {
        "prompt_tokens": um.get("promptTokenCount", 0) or 0,
        "completion_tokens": (um.get("candidatesTokenCount", 0) or 0)
        + (um.get("thoughtsTokenCount", 0) or 0),
    }
    return {"choices": [{"message": msg, "finish_reason": finish}],
            "model": resp.get("modelVersion") or model, "usage": usage}


class GeminiProvider:
    """Duck-typed to the orchestrator's Provider interface (no inheritance → no circular import)."""
    name = "gemini"
    chat_url = GEMINI_BASE          # complete() owns the real call; this is for interface parity
    models_url = GEMINI_BASE + "/models"
    context_window = 1000000        # gemini-3.5-flash 1M window; honored by get_context_window()

    def __init__(self, model=None):
        self.model = model or DEFAULT_GEMINI_MODEL

    # ---- key resolution ----
    def _key(self):
        return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""

    # ---- Provider interface parity (used by the shared loop) ----
    def auth_headers(self) -> dict:
        return {"x-goog-api-key": self._key(), "Content-Type": "application/json"}

    def build_body(self, model, messages, *, tools=None, stream=False, response_format=None,
                   max_tokens=None, temperature=None) -> dict:
        return _build_request(model or self.model, messages, tools, max_tokens, temperature)

    def parse_choice(self, j) -> tuple:
        choice = (j.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        return (msg.get("content") or "", msg.get("tool_calls") or [],
                choice.get("finish_reason"), j.get("model"))

    # ---- the gemini execution path ----
    def complete(self, model, messages, *, tools=None, stream=False, on_text=None,
                 response_format=None, max_tokens=None, temperature=None) -> dict:
        """Run one native gemini turn and return a chat-completions-shaped dict. Streams text
        deltas via on_text when given (matches the OpenRouter/codex live-streaming behavior)."""
        model = model or self.model
        body = _build_request(model, messages, tools, max_tokens, temperature)
        headers = {"x-goog-api-key": self._key(), "Content-Type": "application/json"}
        data = json.dumps(body).encode("utf-8")
        if on_text:
            return self._complete_stream(model, data, headers, on_text)
        url = f"{GEMINI_BASE}/models/{model}:generateContent"
        req = Request(url, data=data, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=GEMINI_HTTP_TIMEOUT) as r:
                j = json.loads(r.read().decode("utf-8"))
        except HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:600]
            raise RuntimeError(f"gemini HTTP {e.code}: {detail}")
        return _gemini_to_chat(j, model)

    def _complete_stream(self, model, data, headers, on_text) -> dict:
        url = f"{GEMINI_BASE}/models/{model}:streamGenerateContent?alt=sse"
        req = Request(url, data=data, headers=headers, method="POST")
        text_acc = ""
        fcalls = []              # raw functionCall parts (carry thoughtSignature)
        finish_raw = "STOP"
        usage = {}
        model_ver = model
        try:
            with urlopen(req, timeout=GEMINI_HTTP_TIMEOUT) as r:
                for raw in r:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(payload)
                    except Exception:
                        continue
                    cands = chunk.get("candidates") or []
                    if cands:
                        c0 = cands[0]
                        if c0.get("finishReason"):
                            finish_raw = c0["finishReason"]
                        for part in ((c0.get("content") or {}).get("parts") or []):
                            if part.get("thought"):
                                continue
                            if "functionCall" in part:
                                fcalls.append(part)
                            elif "text" in part:
                                t = part.get("text") or ""
                                if t:
                                    text_acc += t
                                    on_text(t)
                    if chunk.get("usageMetadata"):
                        usage = chunk["usageMetadata"]
                    if chunk.get("modelVersion"):
                        model_ver = chunk["modelVersion"]
        except HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:600]
            raise RuntimeError(f"gemini stream HTTP {e.code}: {detail}")
        parts = []
        if text_acc:
            parts.append({"text": text_acc})
        parts.extend(fcalls)
        native = {"candidates": [{"content": {"parts": parts}, "finishReason": finish_raw}],
                  "usageMetadata": usage, "modelVersion": model_ver}
        return _gemini_to_chat(native, model)
