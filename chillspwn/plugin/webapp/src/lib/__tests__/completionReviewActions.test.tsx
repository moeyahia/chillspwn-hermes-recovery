import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FindingRecord, LessonRecord } from "../../domain/types/operations";
import { ArtifactReportPageSummary, FindingReviewControl, LessonReviewControl, UnresolvedCompletionRecords } from "../../features/runs/CompletionReview";
import { completionArtifactPageTruth, unresolvedCompletionTruth } from "../completionReview";

const mission = { id: "mission-1", name: "Authorized mission" };

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "finding-1", mission, runId: "run-1", title: "Evidence review finding", severity: "low",
    confidence: 0.8, affectedScope: "fixture.local", description: "Bounded finding", impact: "Review required",
    reproductionNotes: null, remediation: null, reviewStatus: "under_review", operatorOverride: false,
    version: 3, evidenceCount: 0, verifiedEvidenceCount: 0,
    createdAt: "2026-07-15T12:00:00.000Z", updatedAt: "2026-07-15T12:01:00.000Z",
    ...overrides,
  };
}

function lesson(overrides: Partial<LessonRecord> = {}): LessonRecord {
  return {
    id: "lesson-1", statement: "Use independent evidence review", lessonType: "strategy",
    applicabilityScope: "mission", engagementId: "eng-1", mission, failureCategory: null,
    retryConditions: null, confidence: 0.8, expectedBenefit: "Preserve evidence quality", risk: "low",
    status: "proposed", authoringAgentId: "run-evaluator", reviewedBy: null, reviewedAt: null,
    expiresAt: null, supersedesLessonId: null, evidenceCount: 1, supportingEvidenceCount: 1, usageCount: 0,
    createdAt: "2026-07-15T12:00:00.000Z", updatedAt: "2026-07-15T12:01:00.000Z",
    ...overrides,
  };
}

describe("Completion Review mutation controls", () => {
  test("requires an explicit audited finding override when verification has no visible support", () => {
    const markup = renderToStaticMarkup(<FindingReviewControl finding={finding()} onReviewed={() => undefined} />);
    expect(markup).toContain("Review finding Evidence review finding");
    expect(markup).toContain("Use audited operator override");
    expect(markup).toContain("written to the audit chain");
    expect(markup).toContain("Record finding review");
  });

  test("shows only the server-supported candidate lifecycle and independent-review boundary", () => {
    const markup = renderToStaticMarkup(<LessonReviewControl lesson={lesson()} onReviewed={() => undefined} />);
    expect(markup).toContain("Review lesson Use independent evidence review");
    expect(markup).toContain("under review");
    expect(markup).toContain("rejected");
    expect(markup).not.toContain("verified");
    expect(markup).toContain("blocks an agent from verifying its own lesson");
  });

  test("renders capped artifact and unresolved pages as partial rather than conclusive", () => {
    const artifactMarkup = renderToStaticMarkup(<ArtifactReportPageSummary truth={completionArtifactPageTruth([], "next-artifact-page")} />);
    expect(artifactMarkup).toContain('data-page-state="partial"');
    expect(artifactMarkup).toContain("total report count is unknown");
    expect(artifactMarkup).not.toContain("0 report artifacts linked to this run");

    const unresolvedMarkup = renderToStaticMarkup(<UnresolvedCompletionRecords truth={unresolvedCompletionTruth([], [], "next-finding-page")} />);
    expect(unresolvedMarkup).toContain('data-page-state="partial"');
    expect(unresolvedMarkup).toContain("not an all-clear result");
    expect(unresolvedMarkup).not.toContain("complete current scope");
  });
});
