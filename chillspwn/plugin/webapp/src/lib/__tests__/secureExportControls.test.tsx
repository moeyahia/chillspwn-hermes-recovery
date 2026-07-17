import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NavigationProvider } from "../../app/router/navigation";
import { operationsApi } from "../../data/api/operations";
import { parseArtifact } from "../../domain/schemas/operations";
import {
  ArtifactDetail,
  EvidenceRunExportControl,
  resolveEvidenceExportBoundary,
  supportsVerifiedArtifactDownload,
} from "../../features/intelligence/IntelligencePage";

function artifact(storageScheme: string, artifactType = "obsidian_attachment") {
  return parseArtifact({
    schemaVersion: "2.4",
    id: "artifact:authorized/1",
    mission: { id: "mission-1", name: "Authorized mission" },
    runId: "run-1",
    run: { id: "run-1" },
    stepId: "step-1",
    actionId: "action-1",
    journey: "guided",
    artifactType,
    contentHash: "a".repeat(64),
    byteSize: 24,
    mediaType: "application/octet-stream",
    sensitivity: "internal",
    metadata: { source: "canonical" },
    storage: { scheme: storageScheme, available: true },
    evaluation: null,
    contextPackIds: [],
    evidence: [{
      id: "evidence-1",
      summary: "Verified attachment integrity",
      evidenceType: "artifact_integrity",
      verificationState: "verified",
      contentHash: "b".repeat(64),
      acquiredAt: "2026-07-15T17:59:00.000Z",
    }],
    delivery: {
      state: "ready",
      downloadable: true,
      code: "verified_vault_attachment",
      reason: "Canonical evidence and vault containment checks passed.",
      remediation: null,
      verifiedEvidenceCount: 1,
    },
    createdAt: "2026-07-15T18:00:00.000Z",
  });
}

function renderArtifactDetail(item: ReturnType<typeof artifact>): string {
  return renderToStaticMarkup(
    <NavigationProvider>
      <ArtifactDetail item={item} loading={false} onRetry={() => undefined} />
    </NavigationProvider>,
  );
}

describe("secure canonical export controls", () => {
  test("builds encoded same-origin URLs for all server-derived downloads", () => {
    expect(operationsApi.artifactDownloadUrl("artifact:authorized/1")).toBe(
      "/api/v2/intelligence/artifacts/artifact%3Aauthorized%2F1/download",
    );
    expect(operationsApi.evidenceRunExportUrl("run:authorized/1")).toBe(
      "/api/v2/intelligence/evidence/runs/run%3Aauthorized%2F1/export",
    );
    expect(operationsApi.runAuditExportUrl("run:authorized/1")).toBe(
      "/api/v2/observability/audit/runs/run%3Aauthorized%2F1/export",
    );
  });

  test("renders verified content delivery only for the exact approved artifact type and scheme", () => {
    const supported = artifact("vault-attachment");
    expect(supportsVerifiedArtifactDownload(supported)).toBeTrue();
    const markup = renderArtifactDetail(supported);
    expect(markup).toContain("Download verified content");
    expect(markup).toContain("/api/v2/intelligence/artifacts/artifact%3Aauthorized%2F1/download");
    expect(markup).toContain("server will re-check mission scope");
    expect(markup).toContain("download=\"\"");

    for (const unsupported of [
      artifact("file"),
      artifact("vault-attachment", "mission_report"),
      { ...supported, storage: { scheme: "vault-attachment", available: false } },
      { ...supported, evidence: [] },
    ]) {
      expect(supportsVerifiedArtifactDownload(unsupported)).toBeFalse();
      const unsupportedMarkup = renderArtifactDetail(unsupported);
      expect(unsupportedMarkup).not.toContain("Download verified content");
      expect(unsupportedMarkup).not.toContain("/download");
    }

    const { delivery: _delivery, ...metadataOnly } = supported;
    expect(supportsVerifiedArtifactDownload(metadataOnly)).toBeFalse();
    expect(renderArtifactDetail(metadataOnly)).toContain("Artifact content remains metadata-only");
  });

  test("exposes evidence export only for a repository-verified same-mission run relation", () => {
    const runId = "run:authorized/1";
    const canonical = resolveEvidenceExportBoundary([
      { runId, run: { id: runId } },
    ], runId, true);
    expect(canonical).toEqual({ state: "canonical", runId });
    const exact = renderToStaticMarkup(<EvidenceRunExportControl boundary={canonical} />);
    expect(exact).toContain("Bounded evidence metadata export");
    expect(exact).toContain("/api/v2/intelligence/evidence/runs/run%3Aauthorized%2F1/export");
    expect(exact).toContain("repository-verified same-mission export boundary");
    expect(exact).toContain("download=\"\"");

    const hidden = resolveEvidenceExportBoundary([], undefined, false);
    expect(renderToStaticMarkup(<EvidenceRunExportControl boundary={hidden} />)).toBe("");

    for (const unresolved of [
      resolveEvidenceExportBoundary([], undefined, true),
      resolveEvidenceExportBoundary([{ runId, run: null }], runId, true),
      resolveEvidenceExportBoundary([{ runId, run: { id: "run-other" } }], runId, true),
    ]) {
      const markup = renderToStaticMarkup(<EvidenceRunExportControl boundary={unresolved} />);
      expect(markup).toContain("Run-scoped export unavailable");
      expect(markup).not.toContain("/export");
    }
  });
});
