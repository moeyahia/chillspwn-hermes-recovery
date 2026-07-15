import { type FormEvent, useRef, useState } from "react";
import { useNavigation } from "../../app/router/navigation";
import { createMission } from "../../data/api/commandOs";
import { ApiError } from "../../data/api/client";
import { useQueryCache } from "../../data/cache/QueryProvider";
import { Button, ButtonLink, Card, ErrorPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";
import type { GuidedMissionRequest } from "../../domain/types/commandOs";
import { lines, requestKey, safeNextUrl } from "./formUtils";

export default function GuidedMissionCreatePage() {
  const { navigate } = useNavigation();
  const queryCache = useQueryCache();
  const idempotencyKey = useRef(requestKey());
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [target, setTarget] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [explanationDepth, setExplanationDepth] = useState<GuidedMissionRequest["explanationDepth"]>("balanced");
  const [executionPreference, setExecutionPreference] = useState<GuidedMissionRequest["executionPreference"]>("manual");
  const [evidenceExpectations, setEvidenceExpectations] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<Error>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!authorized) {
      setError(new Error("Confirm that this Guided mission is authorized before continuing."));
      return;
    }
    const request: GuidedMissionRequest = {
      journey: "guided",
      launch: true,
      authorizationConfirmed: true,
      title: title.trim(),
      objective: objective.trim(),
      target: target.trim() || undefined,
      engagementId: engagementId.trim() || undefined,
      explanationDepth,
      executionPreference,
      evidenceExpectations: lines(evidenceExpectations),
    };
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await createMission(request, idempotencyKey.current);
      queryCache.invalidate("command-os-overview");
      navigate(safeNextUrl(created.nextUrl, `/guided/${encodeURIComponent(created.mission.id)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Guided mission creation failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="os-page os-form-page os-narrow-page">
      <PageHeader eyebrow="Guided mission" title="Start with the authorized objective" description="ChillsPwn will open by explaining the assessment path and recommending one bounded next step. It will not silently advance through consequential actions." actions={<ButtonLink href="/missions/new" variant="quiet">Change journey</ButtonLink>} />
      <form onSubmit={submit} className="os-guided-form">
        <Card>
          <div className="os-guided-contract"><StatusPill status="guided" /><div><strong>Explain → recommend → choose → observe → interpret → record → advance</strong><p>Each exact agent-run action requires a visible decision.</p></div></div>
          <fieldset><legend>Mission context</legend>
            <label>Mission title<input value={title} onChange={(event) => setTitle(event.target.value)} required autoComplete="off" /></label>
            <label>Authorized objective<textarea value={objective} onChange={(event) => setObjective(event.target.value)} required rows={5} /></label>
            <div className="os-field-grid"><label>Target or environment <span>Optional</span><input value={target} onChange={(event) => setTarget(event.target.value)} /></label><label>Engagement ID <span>Optional</span><input value={engagementId} onChange={(event) => setEngagementId(event.target.value)} /></label></div>
          </fieldset>
          <fieldset><legend>How we collaborate</legend>
            <label>Explanation depth<select value={explanationDepth} onChange={(event) => setExplanationDepth(event.target.value as GuidedMissionRequest["explanationDepth"])}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="deep">Deep</option></select></label>
            <fieldset className="os-choice-group"><legend>Execution preference</legend>
              <label className="os-radio-card"><input type="radio" name="execution" value="manual" checked={executionPreference === "manual"} onChange={() => setExecutionPreference("manual")} /><span><strong>I run commands manually</strong><small>The agent explains and interprets; you provide the result.</small></span></label>
              <label className="os-radio-card"><input type="radio" name="execution" value="single_step_agent" checked={executionPreference === "single_step_agent"} onChange={() => setExecutionPreference("single_step_agent")} /><span><strong>Permit single-step agent execution</strong><small>Each represented action and its normalized parameters require your deliberate choice.</small></span></label>
            </fieldset>
            <label>Evidence expectations <span>One per line, optional</span><textarea value={evidenceExpectations} onChange={(event) => setEvidenceExpectations(event.target.value)} rows={4} /></label>
            <label className="os-check-field"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span><strong>I confirm this mission is authorized</strong><small>Only the represented target and engagement scope may be assessed.</small></span></label>
          </fieldset>
          {error && <ErrorPanel title={error instanceof ApiError && error.status === 409 ? "Guided mission is not ready" : "Guided mission could not be created"} error={error} />}
          <div className="os-form-actions"><ButtonLink href="/missions/new" variant="quiet">Back</ButtonLink><span /><Button type="submit" disabled={submitting}>{submitting ? "Creating mission…" : "Start Guided Mission"}</Button></div>
        </Card>
      </form>
    </div>
  );
}
