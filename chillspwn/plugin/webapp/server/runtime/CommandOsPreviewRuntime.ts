let previewRuntimeActive = false;

/**
 * Mark this process as the dedicated Command OS V2 preview entrypoint.
 *
 * The hybrid server is also the legacy application's entrypoint, so eager V2
 * provider/MCP probes must never be inferred from shared configuration or a
 * port number. Only command-os-v2-preview-entry.ts calls this before importing
 * the hybrid runtime.
 */
export function activateCommandOsV2PreviewRuntime(): void {
  previewRuntimeActive = true;
}

export function isCommandOsV2PreviewRuntime(): boolean {
  return previewRuntimeActive;
}
