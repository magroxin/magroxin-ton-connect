# Magroxin Mainnet Release Readiness

This checklist is the release gate for the Mainnet-only token creator. A checked item must have evidence recorded by the person completing it; source-code presence alone is not proof of production readiness.

## Current safety defaults

- [x] Token deployment is hard-disabled in the API.
- [x] Payment request and payment verification are disabled by default.
- [x] Order creation accepts Mainnet only.
- [x] Payment verification fails closed on malformed/incomplete TON Center data.
- [x] CI passed on main after transaction-hash canonicalization (commit `dc2a887c2607790c9b9d443ffce03e984a96a9fe`).

## Required before enabling payments

- [ ] Verify the live Render `/health` endpoint and confirm PostgreSQL connectivity.
- [ ] Verify the live `/tonconnect-manifest.json` response and that its `iconUrl` loads successfully from the public Blogger site.
- [ ] Verify Render environment variables and PostgreSQL backups; never place secrets in source control.
- [ ] Validate TON Center Mainnet responses against a real, known transaction and confirm pagination behavior.
- [ ] Add and test shared, production-safe API rate limits for order creation and payment verification.
- [ ] Run automated tests against representative TON Center response fixtures and database state transitions.
- [ ] Review request logging, alerting, database retention, and incident recovery.
- [ ] Publish clear terms, privacy, refund, and support information.
- [ ] Perform an independent review of Jetton contract/deployment logic and wallet-delivery behavior.

## Required end-to-end release test

- [ ] On Mainnet, create an order and confirm the exact USD-equivalent TON amount and unique `MAGROXIN:<orderId>` comment.
- [ ] Confirm an unrelated payment, wrong sender, wrong amount, wrong comment, bounced/failed transaction, or stale payment never marks an order paid.
- [ ] Confirm the same transaction cannot pay two orders and concurrent verification cannot create duplicate state transitions.
- [ ] Confirm payment verification remains inconclusive (not unpaid/paid) when TON Center is unavailable, malformed, or pagination is exhausted.
- [ ] Only after the above checks pass, explicitly review the production payment flags before enabling them.
- [ ] Keep token deployment disabled until its separate deployment and wallet-delivery flow has been tested and reviewed.

## Release rule

Do not enable payment requests or token deployment solely because CI passes. CI does not prove live Render configuration, live TON Center connectivity, Mainnet payment settlement, or Jetton delivery. Record evidence for every release-gate item before changing production flags.
