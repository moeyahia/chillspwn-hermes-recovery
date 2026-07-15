# Accessibility evidence

Target: WCAG 2.2 AA for the primary Command OS flows.

Current acceptance status: **partial**. The focused structural/browser slice
passed as recorded below; full WCAG 2.2 AA conformance is not claimed. The
populated mission, decision, recovery, completion, memory-control, and vault
conflict workflows still need keyboard and screen-reader acceptance.

## Automated checks run

The repeatable browser slice is:

```text
playwright test tests/e2e/performance-accessibility.spec.ts
```

It runs against a production build and a fresh isolated canonical database. On
2026-07-15 the focused checks produced these results:

| Check | Coverage | Result |
| --- | --- | --- |
| Structural audit | Overview, Second Brain, graph, Guided creation | pass |
| Keyboard | skip link, main focus, command palette, visible focus | pass |
| Focus restoration | Escape returns focus to the palette trigger | pass |
| Reduced motion | all computed animation/transition durations <= 1 ms; no infinite animations | pass |
| Mobile reflow | five primary routes at 390 x 844 | pass |
| Document overflow | Overview, Guided creation, Brain, graph, Observability | none detected |
| Primary touch targets | visible Command OS buttons, navigation, brand, command control | all at least 44 x 44 CSS px |
| Basic semantics | language, one main, one h1, landmarks, heading order, unique IDs, names, image alt attributes | pass on audited routes |

The structural audit is deliberately dependency-free. It checks rendered
semantics and common deterministic failures but is not presented as a complete
WCAG conformance scanner.

## Defects found and corrected

The checks found two concrete keyboard/mobile defects:

- closing the command palette did not restore focus to the invoking control;
- the compact mobile command control was 42 px tall and lost its accessible
  name when its visible text was hidden.

The palette now records and restores its trigger, and the compact command
control has an explicit accessible name and a 44 px minimum height. The test
also protects the mobile sidebar from the legacy broad sidebar selector that
previously pushed content below the viewport.

## Implemented foundations

- skip link and one stable main landmark;
- ordered page headings and named navigation regions;
- text status in addition to semantic color;
- global `:focus-visible` treatment;
- named icon-only controls;
- keyboard command palette with trapped focus and Escape handling;
- polite live-region connection updates;
- a canvas graph with keyboard instructions and an accessible table view;
- a global reduced-motion rule plus route-specific motion reductions;
- responsive reflow rather than a shrunken desktop window manager;
- 44 px design-system controls.

## Manual verification still required

No automated tool proves WCAG conformance. Before a public release, complete
and record:

- NVDA/Firefox and VoiceOver/Safari reading order and announcements;
- 200 percent browser zoom across every primary route;
- contrast measurements for every semantic state and generated image overlay;
- focus order inside every populated decision, recovery, and graph inspector;
- keyboard operation of a graph populated with real scoped nodes;
- error identification and instructions on every validation path;
- touch testing on physical iOS and Android devices;
- an axe-core or equivalent independent audit if that dependency is approved.

Those checks are intentionally listed as outstanding; this report does not
claim screen-reader or full WCAG certification.

## Route and state coverage still required

The automated structural audit currently samples Overview, Second Brain, the
empty graph, Guided creation, and mobile Observability. Before release, extend
the evidence to populated and error states for:

- the six-step Autonomous contract, including validation summary and blocked readiness;
- Guided Commander messages, exact decision controls, evidence upload/interpretation, and recovery;
- Live Operations with a running/recovering run and the technical drawer;
- Mission completion, report/evidence export, and lesson review;
- candidate confirmation, correction, forgetting confirmation, Memory Control, and vault conflict resolution;
- a populated canvas graph and its table alternative;
- reconnecting, offline, permission-denied, safe-stop, and partial-data states;
- every primary route at 200 percent zoom and a mobile viewport.

Focus must not move merely because a live event updates a row. Critical state
changes must be announced once without repeatedly interrupting the operator.
