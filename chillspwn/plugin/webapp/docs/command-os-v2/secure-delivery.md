# Secure artifact and export delivery

Command OS treats artifact metadata and artifact bytes as separate authorization
surfaces. A non-empty `artifacts.storage_uri` does not make content downloadable.

## Storage-scheme audit

| Scheme | Producer or observed use | Content delivery |
| --- | --- | --- |
| `vault-attachment://<connection>/<sha256>` | Obsidian vault attachment import | Supported only through the configured `VaultPathPolicy` root |
| `legacy-migration-source://` | Legacy migration provenance | Metadata only; the migration read source is not a delivery root |
| `artifact://` | Legacy records and development fixtures | Metadata only; there is no canonical backing-store contract |
| `file://` | Legacy/test records | Denied; arbitrary local paths are never opened |
| `http://` / `https://` | Legacy/test records | Denied; remote URLs, credentials, redirects, and signed URL policy are not canonicalized |
| Any other scheme | Unknown producer | Denied by default |

The only content endpoint is:

`GET /api/v2/intelligence/artifacts/:artifactId/download`

It requires an authenticated actor with `canDownloadArtifactContent`, authorized
mission/engagement scope, sufficient sensitivity clearance, and an injected
vault path policy using the same explicit allowed root as the Obsidian bridge.
The record must be an `obsidian_attachment` whose exact storage URI, connection
ID, SHA-256, and byte size are valid. The service then containment-checks the
content-addressed path, rejects symbolic links and non-regular files, enforces a
bounded byte limit, and verifies size and SHA-256 before emitting any bytes or a
success audit record. Its read-only vault resolver fails if the configured vault
is missing; a download attempt never recreates vault directories.

The response is always an inert `application/octet-stream` attachment with a
server-derived filename, `nosniff`, a sandbox content-security policy,
same-origin resource policy, `no-store`, and an exact content length. Vault
paths, connection paths, and storage URIs never appear in responses or audits.

Successful delivery appends `artifact.content_downloaded` to the immutable audit
chain. Failed scope, policy, containment, size, or integrity checks do not append
a success audit.

## Evidence metadata bundle

`GET /api/v2/intelligence/evidence/runs/:runId/export`

This endpoint requires `canExportEvidenceBundles`. It exports a bounded,
scope-checked, sensitivity-filtered JSON bundle containing evidence identity,
hashes, verification metadata, bounded summaries, chain-of-custody event
identity, finding links, and visible artifact descriptors. It deliberately omits
raw evidence, extracted text, provenance payloads, chain-event details, artifact
locations and contents, provider/tool payloads, conversations, and authentication
material. Artifact identifiers linked from evidence are returned only when the
artifact is independently visible at the caller's sensitivity level.

The bundle has a canonical SHA-256 integrity digest and a truncation map. The
export appends `evidence.bundle_exported` to the immutable audit chain.

## Run audit export

`GET /api/v2/observability/audit/runs/:runId/export`

This endpoint requires both `canExportAuditRecords` and restricted-sensitivity
clearance. It returns only the exact authorized run's bounded audit subset.
Reasons and structured details pass through credential redaction and string,
depth, collection, record-count, and response-size bounds. The response includes
the stored record hashes, but explicitly identifies itself as a subset because
the canonical audit chain is global and omitted records can make adjacent hashes
non-contiguous.

The export has its own canonical SHA-256 digest and appends
`audit.records_exported` after the exported snapshot is built. It never includes
records for another mission or run.

## Remaining storage blocker

Reports and other non-vault artifacts cannot safely expose bytes until their
producers write to a dedicated canonical artifact store with all of the
following: an explicit allowed root or trusted object-store adapter, stable
content-addressed identity, immutable byte size and hash, atomic writes,
retention and deletion semantics, sensitivity labels, mission ownership, and a
delivery adapter that revalidates authorization and integrity at the point of
use. The API intentionally does not infer such a contract from a URI.
