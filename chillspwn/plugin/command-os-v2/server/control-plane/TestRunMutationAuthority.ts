import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { ControlPlaneLeaseService, type ControlPlaneLease } from "./ControlPlaneLeaseService";

/**
 * Disposable Playwright-only authority. The standalone server enables this
 * only after validating its database is under the isolated E2E root. It is
 * never selected by production configuration and never accepts HTTP input.
 */
export const TEST_RUN_MUTATION_LEASE_OWNER = "command-os-v2-e2e-fixture-runtime";

export function testRunMutationLeaseToken(runId: string): string {
  return createHash("sha256")
    .update(`command-os-v2-e2e-fixture-lease\0${runId}`, "utf8")
    .digest("hex");
}

export function acquireTestRunMutationAuthority(
  database: SqliteDatabase,
  runId: string,
  now: Date = new Date(),
): ControlPlaneLease {
  return new ControlPlaneLeaseService(database).acquire({
    runId,
    controlPlane: "command_os_v2",
    leaseOwner: TEST_RUN_MUTATION_LEASE_OWNER,
    leaseToken: testRunMutationLeaseToken(runId),
    ttlMs: 300_000,
    now,
  }).lease;
}

export function assertTestRunMutationAuthority(
  database: SqliteDatabase,
  runId: string,
  now: Date = new Date(),
): ControlPlaneLease {
  return new ControlPlaneLeaseService(database).assertMutationAuthority({
    runId,
    controlPlane: "command_os_v2",
    leaseOwner: TEST_RUN_MUTATION_LEASE_OWNER,
    leaseToken: testRunMutationLeaseToken(runId),
    now,
  });
}
