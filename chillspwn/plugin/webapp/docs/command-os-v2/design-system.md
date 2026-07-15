# Design system

The Command OS design system is token-first. CSS custom properties are the source of truth; utilities and component variants consume them.

## Token families

- surfaces: canvas, base, raised, overlay, selected;
- text: primary, secondary, muted, inverse;
- borders: subtle, default, strong, focus;
- brand/status: lime, information blue, decision/degraded amber, failure/destructive red, defined violet;
- spacing: 4 px base scale;
- typography: system grotesk stack for product text, legible system mono for identifiers and payloads only;
- radii, elevation, density, motion, easing, z-index, chart semantics.

Acid lime is reserved for identity, selection, live progress, and healthy connections. Meaning is never conveyed by color alone. Primary controls have a minimum 44 by 44 CSS pixel target.

## Motion

Motion communicates event entry, ownership transfer, step transition, decision blocking, recovery, evidence attachment, and completion. Nonessential motion stops in hidden tabs and is removed under `prefers-reduced-motion`.

## Component rules

- Every async surface names the operation, owner, elapsed time, heartbeat, expected transition, and recovery/cancel action after two seconds.
- Raw payloads live in an explicit technical drawer.
- Semantic activity cards state purpose, result, evidence delta, policy/decision basis, memory context, and next action.
- Tables and graphs have keyboard-readable list alternatives.
- Generated media is lazy, optional, and never the source of operational meaning.
