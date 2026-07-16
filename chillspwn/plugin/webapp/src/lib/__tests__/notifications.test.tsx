import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NavigationProvider } from "../../app/router/navigation";
import { QueryCache } from "../../data/cache/QueryProvider";
import { invalidateNotificationQueries } from "../../data/events/EventStreamProvider";
import {
  parseNotificationMutation,
  parseNotificationPage,
  parseNotificationUnreadCount,
} from "../../domain/schemas/notifications";
import { NotificationPanel } from "../../features/notifications/NotificationCenter";

const payload = {
  schemaVersion: "2.1",
  nextCursor: null,
  items: [{
    id: "notification:event-safe-stop",
    eventId: "event-safe-stop",
    eventType: "run.autonomous_safe_stopped",
    notificationType: "autonomous_safe_stop",
    severity: "critical",
    title: "Autonomous run safe-stopped",
    body: "The run stopped safely because no permitted in-contract path remained.",
    mission: { id: "mission-1", name: "Authorized mission", engagementId: "eng-1" },
    run: { id: "run-1", journey: "autonomous" },
    sensitivity: "private",
    deepLink: "/live/run-1",
    readAt: null,
    createdAt: "2026-07-15T19:00:00.000Z",
  }],
};

function withWindow<T>(operation: () => T): T {
  const original = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname: "/", search: "" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      history: { pushState: () => undefined, replaceState: () => undefined },
      scrollTo: () => undefined,
    },
  });
  try { return operation(); } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: original });
  }
}

describe("in-app notification client", () => {
  test("validates scoped notification, count, and idempotent mutation envelopes", () => {
    const parsed = parseNotificationPage(payload);
    expect(parsed.items[0]).toMatchObject({
      eventId: "event-safe-stop",
      run: { journey: "autonomous" },
      deepLink: "/live/run-1",
    });
    expect(parseNotificationUnreadCount({ schemaVersion: "2.1", unreadCount: 1 }).unreadCount).toBe(1);
    expect(parseNotificationMutation({
      schemaVersion: "2.1",
      mutation: {
        kind: "mark_read", notificationId: "notification:event-safe-stop",
        changedCount: 1, readAt: "2026-07-15T19:01:00.000Z",
      },
    }).mutation.changedCount).toBe(1);
    expect(() => parseNotificationPage({
      ...payload,
      items: [{ ...payload.items[0], deepLink: "//external.invalid" }],
    })).toThrow("deep link");
    expect(() => parseNotificationMutation({
      schemaVersion: "2.1",
      mutation: { kind: "mark_all_read", notificationId: "unexpected", changedCount: 1, readAt: "now" },
    })).toThrow("identity");
  });

  test("renders an accessible semantic inbox and states the in-app-only contract", () => {
    const item = parseNotificationPage(payload).items[0]!;
    const markup = withWindow(() => renderToStaticMarkup(
      <NavigationProvider>
        <NotificationPanel
          items={[item]}
          unreadCount={1}
          hasMore
          onMarkRead={() => undefined}
          onMarkAllRead={() => undefined}
          onLoadMore={() => undefined}
          onClose={() => undefined}
        />
      </NavigationProvider>,
    ));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="In-app notifications"');
    expect(markup).toContain("Autonomous run safe-stopped");
    expect(markup).toContain("Authorized mission · Autonomous");
    expect(markup).toContain("Mark Autonomous run safe-stopped as read");
    expect(markup).toContain("Load older notifications");
    expect(markup).toContain("In-app delivery only. No email, SMS, or webhook is configured.");
    expect(markup).not.toContain("providerOutput");
  });

  test("invalidates only the two mounted notification queries on a live semantic event", async () => {
    const cache = new QueryCache();
    await cache.fetch("notifications:recent", async () => payload, 60_000);
    await cache.fetch("notifications:unread", async () => ({ unreadCount: 1 }), 60_000);
    await cache.fetch("unrelated", async () => ({ stable: true }), 60_000);

    invalidateNotificationQueries(cache);

    expect(cache.read("notifications:recent")?.updatedAt).toBe(0);
    expect(cache.read("notifications:unread")?.updatedAt).toBe(0);
    expect(cache.read("unrelated")?.updatedAt).toBeGreaterThan(0);
  });
});
