import { describe, expect, test } from "bun:test";
import { resolveSessionHistoryState } from "../sessionHistoryState";

describe("resolveSessionHistoryState", () => {
  test("keeps an idle reusable ACP process live without showing generation", () => {
    expect(resolveSessionHistoryState({ status: "running", isLive: true, turnActive: false })).toEqual({
      isLive: true,
      turnActive: false,
    });
  });

  test("reports a genuinely active live turn", () => {
    expect(resolveSessionHistoryState({ status: "running", isLive: true, turnActive: true })).toEqual({
      isLive: true,
      turnActive: true,
    });
  });

  test("trusts explicit liveness over stale persisted status", () => {
    expect(resolveSessionHistoryState({ status: "running", isLive: false, turnActive: false })).toEqual({
      isLive: false,
      turnActive: false,
    });
  });

  test("preserves compatibility with status-only servers", () => {
    expect(resolveSessionHistoryState({ status: "running" })).toEqual({ isLive: true, turnActive: true });
    expect(resolveSessionHistoryState({ status: "stopped" })).toEqual({ isLive: false, turnActive: false });
  });
});
