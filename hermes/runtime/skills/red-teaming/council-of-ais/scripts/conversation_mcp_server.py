#!/usr/bin/env python3
"""MCP server exposing conversation.mcp recall tools to claude (native MCP).
Registered via `claude mcp add` / .mcp.json — NEVER in buildClaudeArgs.
Engagement dir resolved from CHILLSPWN_ENGAGEMENT_DIR env or the process cwd."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import conversation_recall as cr
from mcp.server.fastmcp import FastMCP

def _eng() -> str:
    return os.environ.get("CHILLSPWN_ENGAGEMENT_DIR") or os.getcwd()

mcp = FastMCP("chillspwn-conversation")

@mcp.tool()
def recall_conversation(query: str = "", max_tokens: int = 8000) -> str:
    """Recall the most relevant past conversation/tool history for `query`,
    up to max_tokens. Use when you need detail that isn't in the current context."""
    return cr.recall(_eng(), query, max_tokens)

@mcp.tool()
def get_recent_conversation(n: int = 20) -> str:
    """Return the last `n` records from the engagement conversation log."""
    return cr.get_recent(_eng(), n)

if __name__ == "__main__":
    mcp.run()
