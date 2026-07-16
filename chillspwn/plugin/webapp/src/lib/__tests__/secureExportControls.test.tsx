import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { operationsApi } from "../../data/api/operations";
import { parseArtifact } from "../../domain/schemas/operations";
import {
  ArtifactDetail,
  EvidenceRunExportControl,
  supportsVerifiedArtifactDownload,
} from "../../features/intelligence/IntelligencePage";

function artifact(storageScheme: string, artifactType = "obsidian_attachment") {
  return parseArtifact({
    schemaVersion: "2.1",
    id: "artifact:authorized/1",
    mission: { id: "mission-1", name: "Authorized mission" },
    runId: "run-1",
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
    createdAt: "2026-07-15T18:00:00.000Z",
  });
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
    const markup = renderToStaticMarkup(
      <ArtifactDetail item={supported} loading={false} onRetry={() => undefined} />,
    );
    expect(markup).toContain("Download verified content");
    expect(markup).toContain("/api/v2/intelligence/artifacts/artifact%3Aauthorized%2F1/download");
    expect(markup).toContain("server will re-check mission scope");
    expect(markup).not.toContain(" download=\"");

    for (const unsupported of [
      artifact("file"),
      artifact("vault-attachment", "mission_report"),
      { ...supported, storage: { scheme: "vault-attachment", available: false } },
    ]) {
      expect(supportsVerifiedArtifactDownload(unsupported)).toBeFalse();
      const unsupportedMarkup = renderToStaticMarkup(
        <ArtifactDetail item={unsupported} loading={false} onRetry={() => undefined} />,
      );
      expect(unsupportedMarkup).toContain("Artifact content remains metadata-only");
      expect(unsupportedMarkup).not.toContain("Download verified content");
      expect(unsupportedMarkup).not.toContain("/download");
    }
  });

  test("exposes evidence export only for an exact valid run context", () => {
    const exact = renderToStaticMarkup(<EvidenceRunExportControl runId="run:authorized/1" />);
    expect(exact).toContain("Bounded evidence metadata export");
    expect(exact).toContain("/api/v2/intelligence/evidence/runs/run%3Aauthorized%2F1/export");
    expect(exact).toContain("exact export boundary");
    expect(exact).not.toContain(" download=\"");
    expect(renderToStaticMarkup(<EvidenceRunExportControl />)).toBe("");
    expect(renderToStaticMarkup(<EvidenceRunExportControl runId="*" />)).toBe("");
    expect(renderToStaticMarkup(<EvidenceRunExportControl runId={"x".repeat(201)} />)).toBe("");
  });
});
