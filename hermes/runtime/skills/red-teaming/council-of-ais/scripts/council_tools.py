"""
council_tools.py — reuse Hermes' REAL tool handlers from our own loop.

We import the Hermes tool *registry* (from the codebase at HERMES_SRC) and call
the registered handlers directly — handler(args, task_id=...). This is reuse,
NOT spoofing: the handlers are decoupled (args, **kw) functions, so no Hermes
agent/gateway/runtime is involved (nothing to stall). We just borrow the tool
implementations.

Exposes the operational toolsets relevant to a pentest council lane by default
(terminal, file, web, code_execution); the full 60+ Hermes tools remain
reachable by adding their toolset name to `toolsets`.
"""
import asyncio
import importlib
import inspect
import json
import os
import pkgutil
import sys

# #58 — prefer the VENDORED Hermes code (copied into the ChillsPwn tree, so the OpenRouter tools
# no longer depend on the external /media/sf_hermes-agent mount being present). Fall back to the
# upstream shared folder if the vendored copy is missing. Override with CHILLSPWN_HERMES_SRC.
_VENDORED = "/root/.claude/chillspwn/vendor/hermes"
_UPSTREAM = "/media/sf_hermes-agent"
HERMES_SRC = os.environ.get("CHILLSPWN_HERMES_SRC") or (
    _VENDORED if os.path.isdir(os.path.join(_VENDORED, "tools")) else _UPSTREAM)
if HERMES_SRC not in sys.path:
    sys.path.insert(0, HERMES_SRC)

from tools.registry import registry          # noqa: E402
import tools as _toolspkg                     # noqa: E402

IMPORT_ERRORS = {}


def _load_all_tool_modules():
    """Import every tools.* module so each one's module-level
    registry.register() runs and populates the registry."""
    for m in pkgutil.iter_modules(_toolspkg.__path__):
        try:
            importlib.import_module(f"tools.{m.name}")
        except Exception as e:  # a tool module with a missing optional dep
            IMPORT_ERRORS[m.name] = f"{type(e).__name__}: {e}"


_load_all_tool_modules()


def _register_builtin_web_providers():
    """Register Hermes' bundled web-search providers (firecrawl).

    The provider PLUGINS register via Hermes' plugin-manifest loader
    (`plugins/web/<name>/__init__.py:register(ctx)`), which only runs inside the
    full Hermes agent — NOT in our standalone council/orchestrator import path.
    Without this, web_search/web_extract resolve no provider ("No web search
    provider configured") even when FIRECRAWL_API_KEY + web.backend=firecrawl are
    set. We call the bundled provider's module-level register directly. Best-effort
    and idempotent (register_provider overwrites by name)."""
    try:
        from agent.web_search_registry import register_provider
        from plugins.web.firecrawl.provider import FirecrawlWebSearchProvider
        register_provider(FirecrawlWebSearchProvider())
    except Exception as e:  # missing firecrawl plugin / optional dep — leave web off
        IMPORT_ERRORS["_web_providers"] = f"{type(e).__name__}: {e}"


_register_builtin_web_providers()

# Operational toolsets a council lane actually needs and that work standalone.
# `web` (web_search/web_extract) is Firecrawl-backed: it needs FIRECRAWL_API_KEY
# (set in ~/.hermes/.env) + web.backend=firecrawl in config.yaml + the firecrawl-py
# SDK + the provider registered above. All four are now in place, so `web` is ON —
# the council/researcher lanes get real web search & extract. Add a toolset name
# here to expose more (browser/discord/etc. need external services or creds).
DEFAULT_TOOLSETS = ("terminal", "file", "code_execution", "web")


def entries(toolsets=DEFAULT_TOOLSETS):
    ts = set(toolsets)
    return [e for e in registry._tools.values() if e.toolset in ts]


def all_entries():
    return list(registry._tools.values())


def list_toolsets():
    out = {}
    for e in registry._tools.values():
        out.setdefault(e.toolset, []).append(e.name)
    return out


def _params(entry):
    s = entry.schema or {}
    return s.get("parameters") or {"type": "object", "properties": {}}


def openai_schemas(toolsets=DEFAULT_TOOLSETS):
    out = []
    for e in entries(toolsets):
        s = e.schema or {}
        out.append({"type": "function", "function": {
            "name": s.get("name", e.name),
            "description": s.get("description", e.description or ""),
            "parameters": _params(e),
        }})
    return out


def anthropic_schemas(toolsets=DEFAULT_TOOLSETS):
    out = []
    for e in entries(toolsets):
        s = e.schema or {}
        out.append({
            "name": s.get("name", e.name),
            "description": s.get("description", e.description or ""),
            "input_schema": _params(e),
        })
    return out


def _handler_map(toolsets=DEFAULT_TOOLSETS):
    return {e.name: e for e in entries(toolsets)}


def dispatch(name, args, task_id="council", toolsets=DEFAULT_TOOLSETS):
    """Execute the tool the model chose, via the real Hermes handler.
    Always returns a string (errors are returned, never raised, so the agent
    loop keeps going)."""
    ent = _handler_map(toolsets).get(name)
    if ent is None:
        return json.dumps({"error": f"unknown/unavailable tool: {name}"})
    try:
        res = ent.handler(args or {}, task_id=task_id)
        if inspect.iscoroutine(res):          # some handlers (e.g. web_extract) are async
            res = asyncio.run(res)
    except Exception as e:
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
    if isinstance(res, (dict, list)):
        return json.dumps(res, ensure_ascii=False)
    return str(res)
