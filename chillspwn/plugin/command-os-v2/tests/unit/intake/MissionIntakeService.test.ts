import { describe, expect, test } from "bun:test";
import { MissionIntakeService, MissionIntakeValidationError } from "../../../server/intake";
import { completeRuntimeManifests } from "../domain/fixtures";

const service = new MissionIntakeService({
  readRuntimeManifests: () => completeRuntimeManifests(),
  clock: () => new Date("2026-07-16T12:00:00.000Z"),
});

describe("MissionIntakeService", () => {
  test("resolves the minimal Autonomous intake into a complete conservative contract", () => {
    const resolved = service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "10.10.10.0/24" }],
    });

    expect(resolved.request.journey).toBe("autonomous");
    if (resolved.request.journey !== "autonomous") throw new Error("Expected Autonomous request");
    expect(resolved.request.title).toBe("Safe Recon — 10.10.10.0/24 — 2026-07-16");
    expect(resolved.request.objective).toContain("Authorized scope: 10.10.10.0/24");
    expect(resolved.request.successCriteria.length).toBeGreaterThan(0);
    expect(resolved.request.contract.deliverables.length).toBeGreaterThan(0);
    expect(resolved.request.contract.evidenceRequirements.length).toBeGreaterThan(0);
    expect(resolved.request.contract.safeStopConditions).toContain("budget_reached");
    expect(resolved.request.contract.destructivePolicy).toBe("prohibited");
    expect(resolved.mandatorySafeStopIds).toContain("target_outside_authorized_scope");
    expect(resolved.inferredFields).toContain("title");
    expect(resolved.normalizedTargets[0]?.type).toBe("cidr");
  });

  test("resolves minimal Guided intake without forcing the Autonomous contract form", () => {
    const resolved = service.resolve({
      journey: "guided",
      authorizationAcknowledged: true,
      targets: [{ value: "https://portal.example.test" }],
      templateId: "external_web_assessment",
    });

    expect(resolved.request.journey).toBe("guided");
    if (resolved.request.journey !== "guided") throw new Error("Expected Guided request");
    expect(resolved.request.target).toBe("https://portal.example.test");
    expect(resolved.request.title).toContain("External Web Assessment");
    expect(resolved.request.explanationDepth).toBe("balanced");
    expect(resolved.request.executionPreference).toBe("manual");
  });

  test("templates preserve exact supplied target scope", () => {
    const resolved = service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [
        { value: "portal.example.test" },
        { value: "admin.example.test", excluded: true },
      ],
      templateId: "external_web_assessment",
    });
    if (resolved.request.journey !== "autonomous") throw new Error("Expected Autonomous request");
    expect(resolved.request.authorization.allowedTargets).toEqual(["portal.example.test"]);
    expect(resolved.request.authorization.prohibitedTargets).toEqual(["admin.example.test"]);
  });

  test("rejects missing authorization and targets with actionable issues", () => {
    expect(() => service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: false,
      targets: [],
    })).toThrow(MissionIntakeValidationError);
    try {
      service.resolve({ journey: "autonomous", authorizationAcknowledged: true, targets: [] });
    } catch (error) {
      expect(error).toBeInstanceOf(MissionIntakeValidationError);
      expect((error as MissionIntakeValidationError).issues[0]).toContain("target");
    }
  });

  test("fails closed when no runtime manifest is connected", () => {
    const unavailable = new MissionIntakeService({
      clock: () => new Date("2026-07-16T12:00:00.000Z"),
    });
    const snapshot = unavailable.snapshot();
    expect(snapshot.source.status).toBe("unavailable");
    expect(snapshot.actionClasses.autonomousLaunchReady).toBe(false);
    const resolved = unavailable.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "lab:authorized" }],
    });
    expect(resolved.limitations.join(" ")).toContain("No attested runtime capability manifest");
  });

  test("allows bounded destructive policy only for an exact normalized disposable lab target", () => {
    const base = service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "lab:customer-portal-sandbox" }],
    });
    const labTarget = base.normalizedTargets[0];
    expect(labTarget?.type).toBe("lab_environment");
    const resolved = service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "lab:customer-portal-sandbox" }],
      destructivePolicy: "bounded_lab_only",
      boundedDestructiveTargetIds: [labTarget!.id],
    });
    if (resolved.request.journey !== "autonomous") throw new Error("Expected Autonomous request");
    expect(resolved.request.contract.boundedDestructiveTargets).toEqual(["lab:customer-portal-sandbox"]);
  });

  test("rejects bounded destructive policy without a named disposable lab target", () => {
    const base = service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "10.10.10.0/24" }],
    });
    expect(() => service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "10.10.10.0/24" }],
      destructivePolicy: "bounded_lab_only",
      boundedDestructiveTargetIds: [base.normalizedTargets[0]!.id],
    })).toThrow("is not classified as a disposable lab environment");
    expect(() => service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "lab:customer-portal-sandbox" }],
      destructivePolicy: "bounded_lab_only",
    })).toThrow("Named disposable lab targets are required");
  });

  test("rejects stale bounded targets when the destructive policy is not bounded", () => {
    expect(() => service.resolve({
      journey: "autonomous",
      authorizationAcknowledged: true,
      targets: [{ value: "lab:customer-portal-sandbox" }],
      destructivePolicy: "prohibited",
      boundedDestructiveTargetIds: ["target_stale"],
    })).toThrow("only with the bounded lab-only destructive policy");
  });

  test("all free-text intake fields have a useful example", () => {
    const fields = service.snapshot().fields;
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.purpose.trim().length).toBeGreaterThan(20);
      expect(field.example.trim().length).toBeGreaterThan(5);
    }
  });
});
