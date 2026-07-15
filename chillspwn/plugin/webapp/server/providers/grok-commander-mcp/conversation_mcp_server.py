#!/usr/bin/env python3
"""Native MCP read-only recall tools for one authorized engagement."""
import os

import conversation_recall as conversation
from mcp.server.fastmcp import FastMCP


def _engagement() -> str:
    return os.environ.get("CHILLSPWN_ENGAGEMENT_DIR") or os.getcwd()


mcp = FastMCP("chillspwn-conversation")


@mcp.tool()
def recall_conversation(query: str = "", max_tokens: int = 8000) -> str:
    """Recall bounded relevant records from this engagement's durable log."""
    return conversation.recall(_engagement(), query, max_tokens)


@mcp.tool()
def get_recent_conversation(n: int = 20) -> str:
    """Return a bounded recent window from this engagement's durable log."""
    return conversation.get_recent(_engagement(), n)


if __name__ == "__main__":
    mcp.run()
