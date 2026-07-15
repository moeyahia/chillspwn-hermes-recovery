import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppLink } from "../../app/router/navigation";
import { guidedCommanderApi } from "../../data/api/guidedCommander";
import { useGuidedTranscript } from "../../data/queries/guidedCommander";
import { useEventStream } from "../../data/events/EventStreamProvider";
import type {
  GuidedCommanderMessage,
  GuidedCommanderReplyEnvelope,
  GuidedCommanderStep,
  GuidedRememberInput,
  GuidedTextResultInput,
} from "../../domain/types/guidedCommander";
import { Button, ErrorPanel, LoadingPanel, StatusPill } from "../../design-system/components/Primitives";
import { ContextPackPanel } from "../brain/ContextPackPanel";
import { formatTime } from "../runs/OperationalSurface";
import {
  GUIDED_TEXT_RESULT_LIMIT,
  mediaTypeForTextFile,
  memoryCandidatesBySource,
  responsePresentation,
  suggestedMemorySummary,
  suggestedMemoryTitle,
  utf8ByteSize,
  type GuidedTextMediaType,
} from "./guidedCommanderUi";

type ContextAction = "explain_more" | "show_next_step" | "use_another_approach";

interface MutationState {
  readonly pending?: string;
  readonly error?: Error;
  readonly message?: string;
}

function requestKey(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function uniqueMessages(
  durable: readonly GuidedCommanderMessage[],
  recent: readonly GuidedCommanderMessage[],
): readonly GuidedCommanderMessage[] {
  const byId = new Map<string, GuidedCommanderMessage>();
  [...durable, ...recent].forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) => {
    const dateOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return dateOrder || left.id.localeCompare(right.id);
  });
}

export function GuidedCommanderPanel({ missionId, runId }: { missionId: string; runId: string }) {
  const transcript = useGuidedTranscript(missionId, runId);
  const stream = useEventStream();
  const [recentMessages, setRecentMessages] = useState<readonly GuidedCommanderMessage[]>([]);
  const [note, setNote] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultSource, setResultSource] = useState<"paste" | "text_upload">("paste");
  const [resultMediaType, setResultMediaType] = useState<GuidedTextMediaType>("text/plain");
  const [resultFileName, setResultFileName] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [memoryMessageId, setMemoryMessageId] = useState<string>();
  const [contextPackId, setContextPackId] = useState<string>();
  const [localCandidates, setLocalCandidates] = useState<Record<string, { candidateId: string; status: string }>>({});
  const [mutation, setMutation] = useState<MutationState>({});
  const controllers = useRef(new Set<AbortController>());
  const retryKeys = useRef(new Map<string, string>());
  const automaticExplanations = useRef(new Set<string>());

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, []);

  useEffect(() => {
    const event = stream.lastEvent;
    if (event?.runId === runId && event.type.startsWith("guided.commander.")) transcript.refresh();
  }, [stream.lastEvent?.id, runId]);

  useEffect(() => {
    if (!transcript.data?.items.length) return;
    const durableIds = new Set(transcript.data.items.map((message) => message.id));
    setRecentMessages((current) => current.filter((message) => !durableIds.has(message.id)));
  }, [transcript.data?.items]);

  const messages = useMemo(
    () => uniqueMessages(transcript.data?.items ?? [], recentMessages),
    [transcript.data?.items, recentMessages],
  );
  const durableCandidates = useMemo(() => memoryCandidatesBySource(messages), [messages]);
  const candidates = useMemo(() => {
    const result = new Map(durableCandidates);
    Object.entries(localCandidates).forEach(([messageId, candidate]) => result.set(messageId, candidate));
    return result;
  }, [durableCandidates, localCandidates]);
  const step = transcript.data?.currentStep;

  async function runMutation<T>(input: {
    kind: string;
    signature: string;
    operation: (key: string, signal: AbortSignal) => Promise<T>;
    success: string;
  }): Promise<T | undefined> {
    const controller = new AbortController();
    controllers.current.add(controller);
    const key = retryKeys.current.get(input.signature) ?? requestKey(`guided-${input.kind}`);
    retryKeys.current.set(input.signature, key);
    setMutation({ pending: input.kind });
    try {
      const result = await input.operation(key, controller.signal);
      retryKeys.current.delete(input.signature);
      setMutation({ message: input.success });
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("The Guided action failed");
      setMutation({ error });
      return undefined;
    } finally {
      controllers.current.delete(controller);
    }
  }

  function contextualInput(current: GuidedCommanderStep) {
    return {
      runId,
      stepId: current.id,
      expectedFingerprint: current.actionFingerprint,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
  }

  function appendReply(response: GuidedCommanderReplyEnvelope | undefined): void {
    if (!response) return;
    setRecentMessages((current) => uniqueMessages(current, [
      response.result.operatorMessage,
      response.result.assistantMessage,
    ]));
    transcript.refresh();
  }

  async function performContextAction(action: ContextAction): Promise<void> {
    if (!step) return;
    const input = contextualInput(step);
    const response = await runMutation({
      kind: action,
      signature: JSON.stringify({ action, ...input }),
      operation: (key, signal) => action === "explain_more"
        ? guidedCommanderApi.explainMore(missionId, input, key, signal)
        : action === "show_next_step"
          ? guidedCommanderApi.showNextStep(missionId, input, key, signal)
          : guidedCommanderApi.useAnotherApproach(missionId, input, key, signal),
      success: action === "explain_more"
        ? "The Commander added a deeper explanation."
        : action === "show_next_step"
          ? "The Commander reviewed the represented next step."
          : "The Commander compared another in-scope approach without changing the plan.",
    });
    appendReply(response);
  }

  async function interpretResult(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!step || !resultText.trim()) return;
    const byteSize = utf8ByteSize(resultText);
    if (byteSize > GUIDED_TEXT_RESULT_LIMIT) {
      setFileError(`The selected result is ${byteSize.toLocaleString()} bytes. Submit at most ${GUIDED_TEXT_RESULT_LIMIT.toLocaleString()} bytes.`);
      return;
    }
    const input: GuidedTextResultInput = {
      ...contextualInput(step),
      result: {
        source: resultSource,
        mediaType: resultMediaType,
        text: resultText,
        byteSize,
        ...(resultFileName ? { fileName: resultFileName } : {}),
      },
    };
    const response = await runMutation({
      kind: "interpret_result",
      signature: JSON.stringify(input),
      operation: (key, signal) => guidedCommanderApi.interpretResult(missionId, input, key, signal),
      success: "Interpretation recorded. The exact represented step remains paused and incomplete.",
    });
    appendReply(response);
    if (response) {
      setResultText("");
      setResultFileName(undefined);
      setResultSource("paste");
      setResultMediaType("text/plain");
    }
  }

  async function selectTextFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(undefined);
    if (file.size > GUIDED_TEXT_RESULT_LIMIT) {
      setFileError(`Text uploads are limited to ${GUIDED_TEXT_RESULT_LIMIT.toLocaleString()} bytes.`);
      return;
    }
    const mediaType = mediaTypeForTextFile(file);
    if (!mediaType) {
      setFileError("Use a plain text, JSON, CSV, or XML file. Binary files belong in the Evidence Vault.");
      return;
    }
    try {
      const text = await file.text();
      const byteSize = utf8ByteSize(text);
      if (!text || byteSize > GUIDED_TEXT_RESULT_LIMIT) {
        setFileError(text ? "The decoded text exceeds the 128 KiB limit." : "The selected file is empty.");
        return;
      }
      setResultSource("text_upload");
      setResultMediaType(mediaType);
      setResultFileName(file.name);
      setResultText(text);
    } catch {
      setFileError("The browser could not read this text file. Paste the relevant excerpt instead.");
    }
  }

  async function rememberMessage(message: GuidedCommanderMessage, input: Omit<GuidedRememberInput, "runId" | "stepId" | "expectedFingerprint">): Promise<void> {
    if (!step) return;
    const request: GuidedRememberInput = { ...contextualInput(step), ...input };
    const response = await runMutation({
      kind: "remember",
      signature: JSON.stringify(request),
      operation: (key, signal) => guidedCommanderApi.remember(missionId, request, key, signal),
      success: "A reviewable candidate was added to the Memory Inbox. It is not confirmed memory yet.",
    });
    if (!response) return;
    setLocalCandidates((current) => ({
      ...current,
      [message.id]: { candidateId: response.result.candidateId, status: response.result.status },
    }));
    setMemoryMessageId(message.id);
    transcript.refresh();
  }

  async function suppressCandidate(messageId: string, candidateId: string, reason: string): Promise<void> {
    if (!step) return;
    const request = { ...contextualInput(step), candidateId, reason };
    const response = await runMutation({
      kind: "do_not_remember",
      signature: JSON.stringify(request),
      operation: (key, signal) => guidedCommanderApi.doNotRemember(missionId, request, key, signal),
      success: "The candidate was suppressed and will not be used for future retrieval.",
    });
    if (!response) return;
    setLocalCandidates((current) => ({
      ...current,
      [messageId]: { candidateId, status: response.result.status },
    }));
    transcript.refresh();
  }

  useEffect(() => {
    const snapshot = transcript.data;
    const current = snapshot?.currentStep;
    if (!snapshot || !current || ["completed", "failed", "cancelled"].includes(snapshot.run.status)) return;
    const hasCommanderReply = messages.some((message) =>
      message.role === "assistant" && message.structuredContent.kind === "guided_commander_response"
    );
    if (hasCommanderReply || mutation.pending) return;
    const signature = JSON.stringify({
      action: "show_next_step",
      runId,
      stepId: current.id,
      expectedFingerprint: current.actionFingerprint,
    });
    if (automaticExplanations.current.has(signature)) return;
    automaticExplanations.current.add(signature);
    if (!retryKeys.current.has(signature)) {
      retryKeys.current.set(
        signature,
        `guided-auto-next-${runId.slice(0, 80)}-${current.actionFingerprint.slice(0, 20)}`,
      );
    }
    void performContextAction("show_next_step");
  }, [transcript.data?.currentStep?.id, transcript.data?.items, messages, mutation.pending, runId]);

  if (transcript.isLoading) return <LoadingPanel label="Loading the durable Guided transcript" />;
  if (transcript.error && !transcript.data) return <ErrorPanel title="Guided conversation is unavailable" error={transcript.error} onRetry={transcript.refresh} />;
  if (!transcript.data) return null;

  const snapshot = transcript.data;
  const active = Boolean(step) && !["completed", "failed", "cancelled"].includes(snapshot.run.status);
  const pending = Boolean(mutation.pending);
  return (
    <section className="os-guided-commander" aria-labelledby="guided-commander-title">
      <header className="os-guided-commander-header">
        <div>
          <p className="os-eyebrow">Collaborative control plane</p>
          <h2 id="guided-commander-title">Commander conversation</h2>
          <p>Explanation and interpretation are planning-only. The Commander cannot execute tools, mutate the plan, or silently advance this step.</p>
        </div>
        <StatusPill status={active ? "waiting_guided_decision" : snapshot.run.status} />
      </header>

      {transcript.error && <div className="os-guided-inline-warning" role="status">Refresh failed. The last validated transcript remains visible.</div>}
      {snapshot.nextCursor && <div className="os-guided-inline-warning" role="status">This view contains the first 200 durable messages. Additional pages remain available through the transcript API.</div>}

      <div className="os-guided-messages" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="os-guided-conversation-empty">
            <strong>No Commander exchange has been recorded yet.</strong>
            <p>Review the represented step, then ask for its explanation or next-step guidance.</p>
          </div>
        ) : messages.map((message) => {
          const presentation = responsePresentation(message);
          const candidate = candidates.get(message.id);
          const belongsToCurrentStep = Boolean(step) && (message.stepId === step?.id || message.structuredContent.stepId === step?.id);
          return (
            <article key={message.id} className={`os-guided-message os-guided-message--${message.role}`} aria-label={`${message.role} message`}>
              <header>
                <div><strong>{message.role === "assistant" ? "Guided Commander" : message.role === "operator" ? "Operator" : message.role}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div>
                {presentation.confidence !== undefined && <span>{Math.round(presentation.confidence * 100)}% confidence</span>}
              </header>
              <div className="os-guided-message-body">{message.body}</div>
              {presentation.observations.length > 0 && <section className="os-guided-observations"><strong>What changed</strong><ul>{presentation.observations.map((observation) => <li key={observation}>{observation}</li>)}</ul></section>}
              {presentation.recommendedNextStep && <p className="os-guided-recommendation"><strong>Recommended next step</strong>{presentation.recommendedNextStep}</p>}
              {presentation.evidenceId && <p className="os-guided-evidence-note">Evidence <AppLink href={`/intelligence/evidence/${encodeURIComponent(presentation.evidenceId)}`}>{presentation.evidenceId}</AppLink> was retained. Raw submitted text is not placed in reusable memory.</p>}
              {presentation.nextConsequentialActionRequiresDecision && <p className="os-guided-decision-note">The next consequential action still requires the exact Guided decision shown alongside this conversation.</p>}
              <footer>
                {message.contextPackId && <Button type="button" variant="quiet" onClick={() => setContextPackId(contextPackId === message.contextPackId ? undefined : message.contextPackId ?? undefined)}>{contextPackId === message.contextPackId ? "Hide context used" : "Context used"}</Button>}
                {message.role === "assistant" && belongsToCurrentStep && !candidate && <Button type="button" variant="quiet" onClick={() => setMemoryMessageId(memoryMessageId === message.id ? undefined : message.id)}>Remember this</Button>}
                {message.role === "assistant" && belongsToCurrentStep && !candidate && <Button type="button" variant="quiet" onClick={() => setMutation({ message: "Nothing from this response is reusable memory unless you choose Remember this." })}>Do not remember this</Button>}
                {candidate && <StatusPill status={candidate.status}>{candidate.status === "pending" ? "Memory candidate" : candidate.status}</StatusPill>}
                {candidate?.status === "pending" && <Button type="button" variant="quiet" onClick={() => setMemoryMessageId(memoryMessageId === message.id ? undefined : message.id)}>Do not remember this</Button>}
              </footer>
              {contextPackId === message.contextPackId && message.contextPackId && <ContextPackPanel packId={message.contextPackId} />}
              {memoryMessageId === message.id && belongsToCurrentStep && <MemoryCandidateControls
                message={message}
                engagementAvailable={Boolean(snapshot.mission.engagementId)}
                candidate={candidate}
                pending={pending}
                onRemember={(input) => rememberMessage(message, input)}
                onSuppress={(reason) => candidate && suppressCandidate(message.id, candidate.candidateId, reason)}
              />}
            </article>
          );
        })}
      </div>

      <div className="os-guided-composer" aria-describedby="guided-action-boundary">
        <p id="guided-action-boundary">These actions explain the current represented step. They never authorize or execute it.</p>
        <label>Optional context for the Commander<textarea maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ask about a prerequisite, risk, output pattern, or alternative…" /></label>
        <div className="os-guided-context-actions">
          <Button type="button" variant="secondary" disabled={!active || pending} onClick={() => performContextAction("explain_more")}>Explain more</Button>
          <Button type="button" disabled={!active || pending} onClick={() => performContextAction("show_next_step")}>Show next step</Button>
          <Button type="button" variant="secondary" disabled={!active || pending} onClick={() => performContextAction("use_another_approach")}>Use another approach</Button>
        </div>
      </div>

      <form className="os-guided-result-form" onSubmit={interpretResult}>
        <div><p className="os-eyebrow">Planning-only interpretation</p><h3>Interpret observed output — keep this step paused</h3><p>The server hashes, redacts, and retains bounded text as unverified evidence for interpretation. <strong>This does not attest that the represented action succeeded, mark the step complete, or advance the run.</strong> Only the separately labeled exact-step completion control can do that after your review.</p><StatusPill status="planning_only">Interpretation only · no advancement</StatusPill></div>
        <fieldset className="os-guided-result-source">
          <legend>Result source</legend>
          <label><input type="radio" name="guided-result-source" checked={resultSource === "paste"} onChange={() => { setResultSource("paste"); setResultFileName(undefined); }} /> Paste text</label>
          <label><input type="radio" name="guided-result-source" checked={resultSource === "text_upload"} onChange={() => setResultSource("text_upload")} /> Text upload</label>
        </fieldset>
        {resultSource === "text_upload" && <label className="os-guided-file-input">Choose text result<input type="file" accept=".txt,.log,.json,.csv,.xml,text/plain,application/json,text/csv,application/xml,text/xml" onChange={selectTextFile} />{resultFileName && <span>Loaded {resultFileName} · {utf8ByteSize(resultText).toLocaleString()} bytes</span>}</label>}
        <label>Result text<textarea required maxLength={GUIDED_TEXT_RESULT_LIMIT} value={resultText} onChange={(event) => { setResultText(event.target.value); setFileError(undefined); }} placeholder="Paste only the relevant authorized output. Authentication material will be redacted." /></label>
        <div className="os-guided-result-meta"><span>{utf8ByteSize(resultText).toLocaleString()} / {GUIDED_TEXT_RESULT_LIMIT.toLocaleString()} bytes</span><span>{resultMediaType}</span></div>
        {fileError && <p className="os-guided-field-error" role="alert">{fileError}</p>}
        <Button disabled={!active || pending || !resultText.trim()}>Interpret only — keep step paused</Button>
      </form>

      {mutation.error && <ErrorPanel title="The Guided action did not complete" error={mutation.error} />}
      {mutation.message && <p className="os-success-note" role="status">{mutation.message}</p>}
      {mutation.pending && <div className="os-guided-pending" role="status" aria-live="polite"><span className="os-progress-mark" aria-hidden="true" /><span>The planning-only Commander is handling {mutation.pending.replaceAll("_", " ")}. The represented step remains paused.</span></div>}
      {contextPackId && !messages.some((message) => message.contextPackId === contextPackId) && <ContextPackPanel packId={contextPackId} />}
    </section>
  );
}

function MemoryCandidateControls({ message, engagementAvailable, candidate, pending, onRemember, onSuppress }: {
  message: GuidedCommanderMessage;
  engagementAvailable: boolean;
  candidate?: { candidateId: string; status: string };
  pending: boolean;
  onRemember: (input: Omit<GuidedRememberInput, "runId" | "stepId" | "expectedFingerprint">) => void;
  onSuppress: (reason: string) => void;
}) {
  const [nodeType, setNodeType] = useState<GuidedRememberInput["nodeType"]>("source");
  const [title, setTitle] = useState(() => suggestedMemoryTitle(message));
  const [summary, setSummary] = useState(() => suggestedMemorySummary(message));
  const [scope, setScope] = useState<GuidedRememberInput["scope"]>("mission");
  const [sensitivity, setSensitivity] = useState<GuidedRememberInput["sensitivity"]>("private");
  const [reason, setReason] = useState("Do not retain or relearn this candidate");

  useEffect(() => {
    if (scope === "global" && nodeType !== "preference") setScope("mission");
  }, [nodeType, scope]);

  if (candidate?.status === "suppressed") return <div className="os-guided-memory-controls"><p>This candidate is suppressed and unavailable to future retrieval.</p></div>;
  if (candidate?.status === "pending") return <form className="os-guided-memory-controls" onSubmit={(event) => { event.preventDefault(); onSuppress(reason); }}><p>The candidate is awaiting review in the <AppLink href="/brain/inbox">Memory Inbox</AppLink>. Suppression removes it from retrieval and prevents immediate relearning.</p><label>Suppression reason<input required minLength={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><Button type="submit" variant="danger" disabled={pending || reason.trim().length < 2}>Suppress and do not relearn</Button></form>;
  return (
    <form className="os-guided-memory-controls" onSubmit={(event) => {
      event.preventDefault();
      onRemember({ sourceMessageId: message.id, nodeType, title: title.trim(), summary: summary.trim(), scope, sensitivity });
    }}>
      <p>This creates a candidate only. It cannot influence a future mission until the operator confirms it in the Memory Inbox.</p>
      <div className="os-field-grid">
        <label>Memory type<select value={nodeType} onChange={(event) => setNodeType(event.target.value as GuidedRememberInput["nodeType"])}><option value="preference">Preference</option><option value="procedure">Procedure</option><option value="tool">Tool</option><option value="tactic">Tactic</option><option value="technique">Technique</option><option value="source">Source note</option></select></label>
        <label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as GuidedRememberInput["scope"])}><option value="mission">This mission</option><option value="engagement" disabled={!engagementAvailable}>This engagement</option><option value="global" disabled={nodeType !== "preference"}>Global (confirmed preferences only)</option></select></label>
        <label>Sensitivity<select value={sensitivity} onChange={(event) => setSensitivity(event.target.value as GuidedRememberInput["sensitivity"])}><option value="internal">Internal</option><option value="private">Private</option><option value="restricted">Restricted</option></select></label>
      </div>
      <label>Candidate title<input required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Candidate summary<textarea required maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
      <Button disabled={pending || !title.trim() || !summary.trim()}>Add to Memory Inbox</Button>
    </form>
  );
}
