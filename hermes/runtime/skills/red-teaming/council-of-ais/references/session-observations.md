# Council operational observations

Keep observations tied to a specific run's logs; do not treat model latency, cost, or reliability as
permanent facts.

Durable lessons:

1. Count a lane only when its assessment contains substantive Markdown. Exit code zero, an empty
   file, or a placeholder is not completion.
2. Reasoning lanes can spend their budget on tool exploration. The direct worker reserves a final
   write phase, and the monitor retries bounded failures or stalls.
3. Use `time.monotonic()` for elapsed-time decisions because virtual-machine clocks can jump.
4. Do not dump full process command lines while monitoring; prompts can be very large. Use PID,
   state, elapsed time, command name, and assessment byte counts.
5. Feed validated failures and dissent into later rounds. A majority hypothesis is not evidence and
   must be tested against the authorized target.
6. Start and retry lanes only through `council_summon.py`. Raw provider processes bypass scoped
   credentials, billing guards, state tracking, and process cleanup.
7. Claude remains on its CLI subscription, GPT on Codex OAuth, and Grok on xAI OAuth. Missing or
   revoked subscription credentials fail their lane rather than selecting a paid fallback.
