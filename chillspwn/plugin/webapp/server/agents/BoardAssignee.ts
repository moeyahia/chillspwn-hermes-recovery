export interface BoardColumnIdentity {
  persona: string;
  is_backlog?: number | boolean;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/**
 * Resolve an MCP/user-supplied assignee to the exact configured board persona.
 * Self aliases always resolve to the non-executing commander backlog column.
 */
export function canonicalBoardAssignee(
  value: unknown,
  columns: readonly BoardColumnIdentity[],
  orchestrator = "ChillsPwn",
): string | null {
  const key = normalized(value);
  if (!key) return null;
  const orchestratorKey = normalized(orchestrator);
  if (["self", "__plan__", "backlog", "plan", orchestratorKey].includes(key)) {
    const commander = columns.find((column) => normalized(column.persona) === orchestratorKey);
    return commander?.persona || orchestrator;
  }
  return columns.find((column) => normalized(column.persona) === key)?.persona || null;
}
