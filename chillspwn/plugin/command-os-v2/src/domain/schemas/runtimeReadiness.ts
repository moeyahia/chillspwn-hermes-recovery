import type { ExecutionReadiness, RuntimeReadinessSnapshot } from "../types/runtimeReadiness";
import { boolean, nonEmpty, number, object, schema } from "./common";

function executionReadiness(value: unknown, label: string): ExecutionReadiness {
  if (value !== "ready" && value !== "unavailable") {
    throw new Error(`${label} must be ready or unavailable`);
  }
  return value;
}

function availability(value: unknown, label: string): "available" | "unavailable" {
  if (value !== "available" && value !== "unavailable") {
    throw new Error(`${label} must be available or unavailable`);
  }
  return value;
}

export function parseRuntimeReadiness(payload: unknown): RuntimeReadinessSnapshot {
  const root = object(payload, "runtime readiness");
  schema(root);
  if (root.status !== "healthy" && root.status !== "degraded") {
    throw new Error("runtime readiness status is invalid");
  }
  const execution = object(root.execution, "runtime readiness execution");
  const dependencies = object(root.dependencies, "runtime readiness dependencies");
  const providers = object(dependencies.providers, "runtime readiness providers");
  return {
    schemaVersion: "2.4",
    status: root.status,
    execution: {
      autonomous: executionReadiness(execution.autonomous, "autonomous execution"),
      guided: executionReadiness(execution.guided, "Guided execution"),
      actionBoundaryActive: boolean(execution.actionBoundaryActive, "actionBoundaryActive"),
      delegationEnforced: boolean(execution.delegationEnforced, "delegationEnforced"),
      noHandsCommanderEnforced: boolean(execution.noHandsCommanderEnforced, "noHandsCommanderEnforced"),
    },
    dependencies: {
      providers: {
        status: availability(providers.status, "provider availability"),
        declared: number(providers.declared, "providers.declared"),
        callable: number(providers.callable, "providers.callable"),
        enforcing: number(providers.enforcing, "providers.enforcing"),
        guidedCapable: number(providers.guidedCapable, "providers.guidedCapable"),
      },
    },
    checkedAt: nonEmpty(root.checkedAt, "readiness checkedAt"),
  };
}
