import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTraceDetail, parseTracePage } from "../../domain/schemas/operations";
import type { TraceDetailRecord } from "../../domain/types/operations";
import { TraceWaterfall } from "../../features/observability/TraceWaterfall";

const payload = {
  schemaVersion: "2.1",
  trace: {
    id: "trace-1", traceId: "trace-1", status: "completed", summary: "Evidence retained",
    mission: { id: "mission-1", name: "Authorized mission" }, missionCount: 1,
    runId: "run-1", runCount: 1, journey: "autonomous",
    startedAt: "2026-07-15T12:00:00.000Z", endedAt: "2026-07-15T12:00:02.000Z", durationMs: 2_000,
    counts: { events: 1, logs: 0, actions: 1, toolCalls: 0, errors: 0 },
  },
  records: {
    schemaVersion: "2.1", nextCursor: "next-page", items: [{
      id: "action:action-1", sourceId: "action-1", kind: "action", title: "scan",
      summary: "One unique service retained", status: "succeeded",
      mission: { id: "mission-1", name: "Authorized mission" }, runId: "run-1",
      stepId: "step-1", actionId: "action-1", agentId: "recon",
      startedAt: "2026-07-15T12:00:00.000Z", endedAt: "2026-07-15T12:00:02.000Z", durationMs: 2_000,
      correlation: { traceId: "trace-1", spanId: "span-1", parentSpanId: null },
      raw: { actionType: "scan", target: "approved.internal" },
    }],
  },
} as const;

describe("observability trace client contract", () => {
  test("parses bounded trace summaries and detail records", () => {
    const detail = parseTraceDetail(payload);
    expect(detail.trace).toMatchObject({ traceId: "trace-1", counts: { events: 1, actions: 1 } });
    expect(detail.records.items[0]).toMatchObject({ kind: "action", correlation: { spanId: "span-1" } });
    expect(detail.records.nextCursor).toBe("next-page");
    expect(parseTracePage({ schemaVersion: "2.1", nextCursor: null, items: [payload.trace] }).items[0].status).toBe("completed");
    expect(() => parseTraceDetail({ ...payload, trace: { ...payload.trace, status: "invented" } })).toThrow("trace status");
    expect(() => parseTraceDetail({ ...payload, records: { ...payload.records, items: [{ ...payload.records.items[0], kind: "provider_magic" }] } })).toThrow("trace record kind");
  });

  test("renders semantic waterfall content with an explicit redacted technical drawer", () => {
    const detail = parseTraceDetail(payload) as TraceDetailRecord;
    const markup = renderToStaticMarkup(<TraceWaterfall trace={detail.trace} records={detail.records.items} />);
    expect(markup).toContain("One unique service retained");
    expect(markup).toContain("Redacted technical detail");
    expect(markup).toContain("span-1");
    expect(markup).toContain("aria-label=\"Correlated records for trace trace-1\"");
    expect(markup).not.toContain("normalizedArguments");
  });
});
