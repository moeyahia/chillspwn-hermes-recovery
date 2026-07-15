# Memory privacy model

Memory is divided into operator preferences, mission memory, operational knowledge, experience/learning, and sources. Evidence remains a separate immutable class.

## Required controls

- explicit scope and scope ID, including mandatory engagement ID for engagement memory;
- lifecycle, sensitivity, confidence, retention, expiry, confirmation, actor, provenance, and version;
- separate Autonomous-use and Guided-use permissions;
- candidate state for inferred preferences unless consent policy explicitly permits promotion;
- contradiction and stale-memory review rather than silent overwrite;
- persisted context packs showing retrieved, used, ignored, corrected, and influence summaries;
- content-free suppression rules for “forget and do not relearn.”

## Never reusable

Credentials, session tokens, private keys, authentication material, flags, raw hashes, unredacted confidential payloads, and target-specific proof are never written into general memory or preference notes. They remain under evidence retention controls and are linked only by immutable ID where permitted.

## Forgetting

Forgetting deletes node content, versions subject to retention law/policy, embeddings, derived edges, context caches, attachments, and vault projections. The audit retains only a content-free event and optional privacy-safe suppression fingerprint.
