import { classifyFailure, type FailureCategory } from "../supervisor";

export interface McpToolFailureResult {
  readonly error: string | null;
  readonly outputPreview: string;
  readonly isError: boolean;
}

interface CommandEnvelope {
  readonly exitCode: number | null | undefined;
  readonly timedOut: boolean;
  readonly dependencyMissing: boolean;
  readonly sandboxDenied: boolean;
}

/**
 * Parse only the stable, line-oriented command envelope emitted by reviewed
 * local MCP implementations. Deliberately avoid loose prose matching here: a
 * scan result that merely discusses an "exit code" must not become a runtime
 * failure category.
 */
function commandEnvelope(text: string): CommandEnvelope {
  const exitValues = [...text.matchAll(/^(?:Exit Code|Exit):[ \t]*(null|-?\d+)[ \t]*$/gmu)]
    .map((match) => match[1] === "null" ? null : Number(match[1]));
  const nonZero = exitValues.find((value) => value !== null && Number.isSafeInteger(value) && value !== 0);
  const exitCode = nonZero ?? (exitValues.includes(null) ? null : exitValues.at(-1));
  const timedOut = /^Command timed out after \d+ms\.[ \t]*$/mu.test(text);
  const dependencyMissing = /^Error:\s*Required command ["'][^"'\r\n]+["'] is not available in PATH(?:\.|\s|$)/mu.test(text)
    || /^Required command ["'][^"'\r\n]+["'] is not available in PATH(?:\.|\s|$)/mu.test(text)
    || /^(?:Error:\s*)?(?:Failed to start command ["'][^"'\r\n]+["']:\s*)?(?:spawn\s+)?[^\r\n]*\b(?:ENOENT|EACCES)\b[^\r\n]*$/mu.test(text);
  const sandboxDenied = /^Error:[^\r\n]*(?:Operation not permitted|\bEPERM\b)[^\r\n]*$/mu.test(text)
    || /^Stderr:[ \t]*\r?\n[^\r\n]*(?:Operation not permitted|\bEPERM\b)[^\r\n]*$/mu.test(text);
  return { exitCode, timedOut, dependencyMissing, sandboxDenied };
}

function upstreamHttpStatus(text: string): number | undefined {
  const matched = text.match(/\b(?:http(?:\s+error)?|status(?:\s+code)?)\s*[:=]?\s*(\d{3})\b/iu);
  if (!matched) return undefined;
  const status = Number(matched[1]);
  return Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/**
 * Classify the complete normalized MCP result, not only its generic `error`
 * field. Third-party MCP implementations commonly put the actionable upstream
 * HTTP failure in `content` while returning only `isError: true` at the
 * protocol boundary. Keeping the redacted preview in the classifier lets a
 * NVD 429 remain retryable while a stable no-result/validation response remains
 * a deterministic tool error.
 */
export function classifyMcpToolFailure(result: Readonly<McpToolFailureResult>): FailureCategory {
  const message = `${result.error ?? ""}\n${result.outputPreview ?? ""}`.trim();
  const httpStatus = upstreamHttpStatus(message);
  const classified = classifyFailure({
    // `isError` means the MCP process ran and the tool implementation returned
    // the failure content. A bridge/process failure remains an MCP failure.
    source: result.isError ? "tool" : "mcp",
    message,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  if (classified !== "unknown") return classified;
  const envelope = commandEnvelope(message);
  if (envelope.timedOut) return "timeout";
  if (envelope.dependencyMissing) return "dependency_missing";
  // EPERM here is not a transient tool failure: the reviewed local execution
  // sandbox denied the process before it could perform the requested action.
  if (envelope.sandboxDenied) return "policy_denied";
  if (envelope.exitCode === null) return "process_crash";
  if (envelope.exitCode !== undefined && envelope.exitCode !== 0) return "deterministic_tool_error";
  return result.isError ? "deterministic_tool_error" : "unknown";
}
