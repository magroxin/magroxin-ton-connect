# Magroxin Mainnet Release Readiness

This checklist is the release gate for the Mainnet-only token creator. A checked item must have evidence recorded by the person completing it; source-code presence alone is not proof of production readiness.

## Current safety defaults

- [x] Token deployment is hard-disabled in the API.
- [x] Payment request and payment verification are disabled by default.
- [x] Order creation accepts Mainnet only.
- [x] Payment verification fails closed on malformed/incomplete TON Center data.
- [x] Payment verification requires the connected wallet address to match the order wallet (PR #19); this is a consistency guard, not cryptographic ownership proof.
- [x] CI passed on main after the strict transaction-success tests and checklist updates (commit `b0bcbb6c0fd7c0c34521ee14958c147410c18724`; run [39834964846](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39834964846)).
- [x] Latest main CI passed after the strict payment amount validation documentation update (commit `238ead9b51e367e63d54d6d697a3ee4e60198041`; run [39969662050](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39969662050)).
- [x] Payment matcher rejects string-typed transaction timestamps; PR #30 CI passed (run [39921165222](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39921165222)).
- [x] Payment matcher accepts only canonical decimal-string nanoTON values and rejects ambiguous encodings; PR #37 merged after CI passed (run [39962088932](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39962088932)).
- [x] CI verifies committed Jetton BOCs match compiled contract sources (run [39921165222](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39921165222)); independent contract/security review and Mainnet deployment validation remain required.

- [x] Payment matcher boundary regression tests for unsafe timestamps and hash normalization passed in PR #40; merged main CI run [40017114105](https://github.com/magroxin/magroxin-ton-connect/actions/runs/40017114105) succeeded (commit `99fce958fc9c12a51c1dd15fb23dc9da777e6a6f`).
- [x] Malformed payment amount encoding regression tests passed in PR #42; merged main CI run [40075324569](https://github.com/magroxin/magroxin-ton-connect/actions/runs/40075324569) succeeded (commit `7793ca5b0c9f29e4485cf0fbd36f44b9e6712ef0`).

- [x] Reject coerced/non-numeric Binance and CoinGecko quote timestamps; regression tests passed in PR #44 and merged main CI run [40086371821](https://github.com/magroxin/magroxin-ton-connect/actions/runs/40086371821) succeeded (merge commit `a59ffecfd62827b75e642be65aba883af8272503`).

## Required before enabling payments

- [x] Verify the live Render `/health` endpoint and PostgreSQL connectivity; owner confirmed `ok: true`, `databaseConnected: true`, Mainnet, fixed 100 TON service fee, and payment/deployment flags disabled (2026-10-22).
- [x] Verify the live `/tonconnect-manifest.json` response returns the expected Blogger HTTPS origin and Magroxin name (owner confirmed 2026-10-22).
- [x] Owner confirmed the site icon appeared in the TON Connect flow (2026-10-24). Recheck if the manifest icon URL changes.
- [ ] Verify Render environment variables and PostgreSQL backups; never place secrets in source control.
- [ ] Validate TON Center Mainnet responses against a real, known transaction and confirm pagination behavior.
- [x] Add shared, production-safe API rate limits for order creation and payment verification; unit tests pass in CI (PR #18, commit `7d07874cc00faed56cc1a23dc79ee755b66d402c`).
- [x] Add strict unit coverage requiring explicit successful TON transaction phase flags (PR #23; included in successful main CI run [39834517226](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39834517226)).
- [ ] Run automated integration tests against representative TON Center response fixtures and database state transitions.
- [ ] Review request logging, alerting, database retention, and incident recovery.
- [ ] Publish clear terms, privacy, refund, and support information.
- [ ] Perform an independent review of Jetton contract/deployment logic and wallet-delivery behavior.

## Required end-to-end release test

- [ ] On Mainnet, create an order and confirm the exact exact 100 TON amount and unique `MAGROXIN:<orderId>` comment.
- [ ] Confirm an unrelated payment, wrong sender, wrong amount, wrong comment, bounced/failed transaction, or stale payment never marks an order paid.
- [ ] Confirm the same transaction cannot pay two orders and concurrent verification cannot create duplicate state transitions.
- [ ] Confirm payment verification remains inconclusive (not unpaid/paid) when TON Center is unavailable, malformed, or pagination is exhausted.
- [ ] Only after the above checks pass, explicitly review the production payment flags before enabling them.
- [ ] Keep token deployment disabled until its separate deployment and wallet-delivery flow has been tested and reviewed.

## Release rule

Do not enable payment requests or token deployment solely because CI passes. CI does not prove live Render configuration, live TON Center connectivity, Mainnet payment settlement, or Jetton delivery. Record evidence for every release-gate item before changing production flags.
