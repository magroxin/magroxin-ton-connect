# Mainnet production-readiness checklist

**Safety rule:** keep payment requests, payment verification, and token deployment disabled until every relevant item below is completed and reviewed. This project is Mainnet-only; do not introduce a Testnet workflow.

## API and operations

- [x] Persist orders in PostgreSQL with a unique payment transaction hash.
- [x] Add PostgreSQL-backed per-wallet order creation limits and per-order verification cooldowns.
- [x] Add shared PostgreSQL-backed API rate limits for order creation, payment-request retrieval, verification, and order reads; trust the Render proxy hop and fail closed if rate-limit storage is unavailable (PR #18).
- [x] Add baseline API response security headers (MIME sniffing, framing, referrer policy, browser permissions).
- [ ] Add structured request/error logs, monitoring, alerting, and documented incident response.
- [ ] Verify production PostgreSQL backups, restore procedure, connection limits, and migrations.
- [ ] Confirm the deployed API uses HTTPS and exact production `CLIENT_ORIGIN` CORS configuration.
- [ ] Redeploy the fixed-100-TON-fee branch and verify `/health` reports Mainnet, `serviceFeeTon: "100"`, and payment requests, payment verification, and deployment disabled.

## Mainnet payment verification

- [x] Add unit tests for the fail-closed payment matcher covering malformed provider data, bounced/missing flags, invalid addresses, sender/recipient/amount/comment mismatches, time boundaries, failed transaction phases, malformed timestamps/hashes, and decoded-comment fallback.
- [x] Test strict transaction-success flags, including explicit compute/action phase success and fail-closed handling of missing or malformed fields (PR #23).
- [x] Require the verification wallet to match the wallet recorded on the order, using normalized TON addresses (PR #19); this is a consistency check, not cryptographic proof of wallet ownership.
- [ ] Validate the TON Center v3 response schema using representative successful, failed, bounced, and malformed Mainnet transactions.
- [ ] Confirm inbound transfer sender, fee-wallet destination, exact nanoTON amount, order comment, transaction timestamp, and transaction success fields.
- [ ] Verify transaction hash canonicalization and duplicate/replay behavior against real provider responses.
- [ ] Add integration tests for underpayment, overpayment, wrong sender, wrong recipient, wrong comment, expired orders, provider errors, pagination cap, and duplicate payment attempts.
- [x] Implement and unit-test reliable quote policy: upward six-decimal fee rounding; provider timestamps; 120-second maximum quote age; rejection of quotes more than 30 seconds in the future; and rejection when available price sources differ by more than 5%. The API uses the highest agreeing fresh quote to avoid under-quoting the fixed TON fee. Live provider behavior and end-to-end order creation still require production verification.
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

- [x] CI passed on main after strict transaction-success tests (commit `47dcd82a4c8375abe2e30f48d0eac26214fc29e7`; [run 39834517226](https://github.com/magroxin/magroxin-ton-connect/actions/runs/39834517226)).
- [ ] Production API health and database connectivity are verified after deployment.
- [ ] Independent end-to-end security review is complete.
- [ ] Only then decide whether to enable payment requests and verification. Token deployment remains separately disabled until its own review is complete.

Never ask users for recovery phrases or private keys. Do not claim payment or deployment success from a wallet submission alone.
