# Mainnet production-readiness checklist

**Safety rule:** keep payment requests, payment verification, and token deployment disabled until every relevant item below is completed and reviewed. This project is Mainnet-only; do not introduce a Testnet workflow.

## API and operations

- [x] Persist orders in PostgreSQL with a unique payment transaction hash.
- [x] Add PostgreSQL-backed per-wallet order creation limits and per-order verification cooldowns.
- [ ] Add general API rate limits for unauthenticated routes, with correct proxy/IP handling for Render.
- [x] Add baseline API response security headers (MIME sniffing, framing, referrer policy, browser permissions).
- [ ] Add structured request/error logs, monitoring, alerting, and documented incident response.
- [ ] Verify production PostgreSQL backups, restore procedure, connection limits, and migrations.
- [ ] Confirm the deployed API uses HTTPS and exact production `CLIENT_ORIGIN` CORS configuration.
- [ ] Verify `/health` against the actual deployed service and confirm feature flags are disabled.

## Mainnet payment verification

- [x] Add unit tests for the fail-closed payment matcher covering malformed provider data, bounced/missing flags, invalid addresses, sender/recipient/amount/comment mismatches, time boundaries, failed transaction phases, malformed timestamps/hashes, and decoded-comment fallback.
- [ ] Validate the TON Center v3 response schema using representative successful, failed, bounced, and malformed Mainnet transactions.
- [ ] Confirm inbound transfer sender, fee-wallet destination, exact nanoTON amount, order comment, transaction timestamp, and transaction success fields.
- [ ] Verify transaction hash canonicalization and duplicate/replay behavior against real provider responses.
- [ ] Add integration tests for underpayment, overpayment, wrong sender, wrong recipient, wrong comment, expired orders, provider errors, pagination cap, and duplicate payment attempts.
- [ ] Add a reliable quote policy: provider timestamp, maximum quote age, rounding behavior, and handling of price-source disagreement.
- [ ] Confirm rate limits and provider quotas cannot cause a payment to be marked paid without a conclusive on-chain match.
- [ ] Keep `ENABLE_PAYMENT_REQUESTS=false` and `ENABLE_PAYMENT_VERIFICATION=false` until independent end-to-end verification is complete.

## Jetton deployment

- [x] CI compiles the Jetton contracts and verifies committed BOCs match the compiled source.
- [ ] Obtain an independent review of the Jetton minter and wallet contracts.
- [ ] Test metadata encoding, owner/admin address, decimals, initial supply, mint behavior, and resulting master address.
- [ ] Implement server-side on-chain deployment confirmation; wallet submission alone must never be shown as success.
- [ ] Verify the fresh paid-order status and wallet Mainnet chain before presenting a deployment transaction.
- [ ] Validate deployment amount and transaction payload with a reviewed, reproducible Mainnet procedure before enabling deployment.
- [ ] Keep the hardcoded deployment block in place until all deployment checks pass.

## Website and customer disclosures

- [x] Replace the placeholder TON Connect manifest/domain value with the production Blogger HTTPS origin.
- [ ] Verify that the manifest icon URL resolves to a valid public icon and is accepted by TON Connect.
- [ ] Publish accurate terms of service, privacy notice, refund policy, and support contact before accepting payments.
- [ ] Ensure the displayed fee, TON quote, quote expiry, and network costs are clearly explained.

## Final release gate

- [ ] All CI checks pass on the exact release commit.
- [ ] Production API health and database connectivity are verified after deployment.
- [ ] Independent end-to-end security review is complete.
- [ ] Only then decide whether to enable payment requests and verification. Token deployment remains separately disabled until its own review is complete.

Never ask users for recovery phrases or private keys. Do not claim payment or deployment success from a wallet submission alone.
