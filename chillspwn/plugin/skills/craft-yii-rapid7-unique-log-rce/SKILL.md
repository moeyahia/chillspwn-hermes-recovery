---
name: craft-yii-rapid7-unique-log-rce
description: Source-verified Craft/Yii CVE-2024-58136 clean RCE via a unique FileTarget log and PhpManager include, without existing logs or sessions.
---

# Craft/Yii Rapid7 Unique-Log RCE

Use only in an authorized environment confirmed vulnerable to Yii <2.0.52 unsafe behavior configuration (commonly Craft CVE-2025-32432).

## Source verification
1. Read Rapid7's CVE-2024-58136 analysis and the matching Yii version source.
2. Confirm `yii\\base\\Application::__construct($config=[])`, required `id`/`basePath`, accepted `runtimePath`, bootstrap resolution, `yii\\log\\FileTarget::init/export`, and `yii\\rbac\\PhpManager::init/load`.
3. Confirm the endpoint-specific outer component property and valid behavior class used to pass the `class` check while `__class` selects the gadget.

## Writer
Use a fresh CSRF/session and instantiate:
- validation `class`: a genuine Behavior available on the authorized target (for example, `craft\\behaviors\\FieldLayoutBehavior`)
- `__class`: `yii\\console\\Application`
- `__construct()`: one application config containing:
  - unique `id`
  - existing `basePath` such as `/tmp`
  - unique `runtimePath` `/tmp/cpwn_<nonce>`
  - `bootstrap: ["log"]`
  - `components.log.targets[0]` class `yii\\log\\FileTarget`
  - levels `error`,`warning`
  - explicit unique `logFile` `/tmp/cpwn_<nonce>/app.log`
  - `enableRotation: false`, bounded `maxFileSize`/`maxLogFiles`

Transport quote-free, query-gated PHP in a request cookie. Preserve default Yii `logVars`; this technique depends on default cookie-context export. Do not set `logVars: []`, which suppresses the transport. A quote-free `chr(N).chr(N)...` expression avoids VarDumper quote escaping.

Payload should emit an exact nonce-bound marker via `printf` only, then call `@unlink(__FILE__); @rmdir(dirname(__FILE__))` in the same gated branch. Do not expose arbitrary command input.

## Include
Use a second fresh CSRF/session and instantiate:
- same valid behavior `class`
- `__class`: `yii\\rbac\\PhpManager`
- `__construct()`: `[{"itemFile":"/tmp/cpwn_<nonce>/app.log"}]`

Add the exact gate key/value to the query string. Success requires one complete exact begin/output/end marker pair. Record HTTP status, response length/SHA-256, raw body, nested exception text, payload JSON, cleanup uncertainty, and residual paths.

## Bounds and safety
- Retain only one validated writer and one include: hard cap two POSTs.
- Use fresh sessions for both.
- Never use existing Nginx/Craft logs, session files, wrappers, filters, upload progress, webroot writes, shells, listeners, persistence, flags, or credentials.
- If no marker, stop and report possible residual unique log; do not change mechanisms merely to delete it.

## Validation criteria
Treat the chain as verified only when the writer reaches the expected configuration-error path and the include returns one complete nonce-bound marker pair. Preserve application defaults unless a prerequisite proves they must change; record status classes and checksums rather than target-specific values.

## Compact command-output transport
When a long `chr()` payload approaches proxy header limits, compare quote-safe forms offline before traffic. Yii `BaseVarDumper` applies `addslashes()` to logged string values, so literal quoted PHP strings are unsafe; retain quote-free `chr()` assembly. For a short command, direct `system(chr(...))` may be smaller than a Base64 decoder or a `passthru` form. Measure the complete prepared request locally and choose the smallest form that retains cleanup and validation markers.

To avoid duplicate exact marker pairs from Yii default `logVars` logging both `_COOKIE` and raw `_SERVER.HTTP_COOKIE`, percent-encode marker bytes in the outbound Cookie value while leaving PHP to URL-decode them into `$_COOKIE`; then the executable logged `_COOKIE` copy has plaintext markers while raw `HTTP_COOKIE` does not. A compact query gate such as `if(count($_GET)>1){...}` works when the normal endpoint already has one query parameter and the include adds one gate parameter. Preserve the exact prepared-request measurement (request line, every full header line including CRLF, header-section total, body, and full request) and abort before POST if conservative local limits fail.
