---
name: gavel-rule-engine-bounded-rce
description: Bounded reversible Gavel admin rule update to one id execution via valid bid, with manual regenerated cookies and byte-equal rollback.
---

# Gavel bounded rule-engine RCE

Use only in an authorized Gavel engagement with a validated `auctioneer` credential and an isolated funded bidder account.

1. Review recovered `admin.php`, `bidding.php`, and `includes/bid_handler.php`; confirm field names remain `auction_id`, `rule`, `message`, and `bid_amount`.
2. Authenticate each account with one raw POST to `/login.php`. The response contains both an initial and regenerated `gavel_session`; send only the **last** Set-Cookie value on subsequent requests.
3. GET `/admin.php` exactly once. Current source renders exact rule/message inside HTML comments; parse and HTML-decode them, plus auction ID and end epoch. Preserve exact strings and SHA-256 hashes restricted.
4. GET `/bidding.php` once with the isolated bidder cookie. Match an admin auction by ID and exact message; require enough remaining time and balance. Choose one bounded bid greater than current price.
5. POST one malicious update to `/admin.php` with the original message and minimal body: `echo 'CPWN_BEGIN_<nonce>';echo shell_exec('id');echo 'CPWN_END_<nonce>';return true;`.
6. POST exactly one valid bid to `/includes/bid_handler.php`; require one complete marker pair containing `uid=`.
7. In a `finally` path, POST exactly one restoration update with the exact original rule and message, then GET `/admin.php` once and verify byte equality and matching SHA-256 values.
8. Never retry or select a second auction if prerequisites change. Preserve raw requests/responses mode 0600 in a mode-0700 directory. Report exact request accounting and do not claim cleanup unless post-restore values are byte-equal.

Validated instance: auction 1212, exact `id` output as uid=33(www-data), 8 total requests (2 login POSTs, 2 admin GETs, 1 bidding GET, 1 malicious update, 1 bid trigger, 1 restore), zero retries, exact rollback verified.
