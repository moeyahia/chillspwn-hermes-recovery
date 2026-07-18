# Command OS V2 design system

Status: V2-only tokens and reusable primitives are implemented. Visual
regression approval across every route and viewport remains a release gate.

## Identity

The canonical legacy `Logo.svg` is copied only by the hash-verifying build
script and rendered directly. The verified hash is
`0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.
Generated media never reproduces or composites the mark.

The selected visual direction is Graphite Command Intelligence: near-black
neutral layers, restrained acid-lime for identity/live progress, blue for
information, amber for decisions/degradation, red for destructive risk or
failure, and violet only for explicitly defined semantics.

## Token source of truth

`src/design-system/tokens/command-os.css` scopes every token beneath
`.command-os`; no legacy CSS variables are imported.

- Surfaces: canvas plus three neutral elevations and a bounded overlay.
- Lines: soft, default, and strong border roles.
- Text: primary, secondary, and muted roles.
- Semantics: accent, information, success, warning, danger, and violet, each
  with a restrained soft surface.
- Type: product sans and technical mono; paragraphs remain sans.
- Space: 4, 8, 12, 16, 20, 24, 32, 40, and 48 pixel-equivalent steps.
- Radius: 4, 8, and 12 pixels.
- Motion: 120 and 200 ms with a shared state-transition easing curve.
- Layering: sidebar, top bar, modal, and command-palette z-index roles.

## Component contract

Primitives provide buttons and links, cards, page headers, status pills,
loading/error/empty states, and accessible structural helpers. Features own
domain composition; they do not create page-local theme variables. Functional
icons use one SVG icon component rather than emoji.

Every interactive primitive must provide:

- a stable semantic role and accessible name;
- keyboard and pointer behavior;
- focus-visible styling;
- loading, disabled, error, and completion states;
- a minimum 44 by 44 CSS-pixel target where it is an action;
- an interaction-manifest record and dedicated coverage for material paths.

Raw JSON and terminal output are secondary expandable detail. Primary activity
uses semantic summaries, status, duration, evidence delta, and next action.

## Motion and media

Motion communicates ownership transfer, state change, evidence attachment,
recovery, or completion. Reduced-motion CSS removes nonessential transitions;
only a minimal live-state indicator may repeat. Brand imagery is optional,
lazy, and excluded from the critical operational bundle. Higgsfield production
assets remain blocked on OAuth and are not replaced with fabricated images.

## Acceptance still outstanding

Approved multi-browser baselines, 200% zoom review, automated accessibility
scan, copy-length stress, and manual alignment sign-off are not yet complete.
Those gaps prevent release approval even though the token system and responsive
shell are operational.
