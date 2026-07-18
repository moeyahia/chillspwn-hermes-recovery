# Learning system

Learning and personal memory are connected but distinct.

Every terminal run receives a journey-aware evaluation covering objective completion, success criteria, evidence/finding/report quality, policy and journey adherence, corrections, memory usefulness, efficiency, repeated actions, recovery, delegation, and uncertainty calibration. Canonical metrics also retain time to first verified evidence, actions with and without a progress signature, exact operator-intervention count, recovery success, tool-call success, memory-context precision, and preference-correction rate. Operator interventions remain descriptive: the comparison engine does not treat fewer Guided decisions as inherently better because that could reward bypassing the exact-step invariant.

Agents may propose lessons with scope, source runs, evidence, counterexamples, confidence, expected benefit, risk, and review date. They cannot approve their own lessons. Promotion requires evidence and an operator/reviewer decision. Contradictions remain visible until resolved.

Failed-attempt lessons record context, action, failure class, evidence, why repetition is unhelpful, and conditions that could make retry valid. They are retrieval inputs for loop detection and recovery.

Impact claims require benchmark or comparable-run evidence. Code, authorization, secrets, tool allowlists, policy, audit history, and benchmark results are never autonomously changed.

The repeatable `bun run performance:missions` gate exercises two explicitly
synthetic, isolated canonical evaluation pairs: Autonomous bounded recovery and
Guided exact-step/context correction. The fixtures are not loaded by production
and are labeled synthetic in their output. They verify comparison direction and
scope; the resulting summary still states that a descriptive comparison does
not, by itself, establish real-world improvement.
