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
- validation `class`: a genuine Behavior available on target (on Orion, `craft\\behaviors\\FieldLayoutBehavior`)
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

Transport quote-free, query-gated PHP in a request cookie. Preserve default Yii `logVars`; the successful Orion path depended on default cookie-context export. Do not set `logVars: []`, which suppresses the transport. A quote-free `chr(N).chr(N)...` expression avoids VarDumper quote escaping.

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

## Orion validated result
On 10.129.34.42, `assetId=11` plus `as session` worked. Writer returned HTTP 500 with expected `Unsupported configuration type: object`; PhpManager include returned HTTP 200 and one exact `RAPID7_OK_<nonce>` marker. The successful variant preserved default `logVars`.

## Compact command-output transport validated on Orion
When a long `chr()` payload exceeds Nginx header limits, compare quote-safe forms offline before traffic. Yii `BaseVarDumper` applies `addslashes()` to logged string values, so literal quoted PHP strings are unsafe; retain quote-free `chr()` assembly. For a short command, direct `system(chr(...))` may be smaller than `system(base64_decode(chr(...)))` or either `passthru` form. On Orion, a 124-byte command selected direct `chr()` + `system`, with cleanup retained, yielding a 1,993-byte maximum complete Cookie header line and 2,379-byte request-line-plus-headers total versus the prior rejected 9,280-byte Cookie line.

To avoid duplicate exact marker pairs from Yii default `logVars` logging both `_COOKIE` and raw `_SERVER.HTTP_COOKIE`, percent-encode marker bytes in the outbound Cookie value while leaving PHP to URL-decode them into `$_COOKIE`; then the executable logged `_COOKIE` copy has plaintext markers while raw `HTTP_COOKIE` does not. A compact query gate such as `if(count($_GET)>1){...}` works when the normal endpoint already has one query parameter and the include adds one gate parameter. Preserve the exact prepared-request measurement (request line, every full header line including CRLF, header-section total, body, and full request) and abort before POST if conservative local limits fail.
