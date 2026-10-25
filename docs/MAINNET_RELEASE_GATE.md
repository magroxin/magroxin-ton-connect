# Mainnet Release Gate

This checklist is required before enabling real payments or Jetton deployment in production.

## Current safety gates

- [ ] Keep `ENABLE_PAYMENT_REQUESTS=false` until payment request and payment verification have passed end-to-end tests.
- [ ] Keep `ENABLE_PAYMENT_VERIFICATION=false` until exact-amount, sender, recipient, comment, time-window, bounced/failed transaction, duplicate transaction, and delayed-indexing cases pass against TON Mainnet.
- [ ] Keep deployment disabled until the backend can independently confirm the exact Jetton master address derived from the submitted StateInit and persist deployment state idempotently.
- [ ] Never interpret a wallet's successful `sendTransaction` return as proof that a transaction succeeded on-chain.

## Payment verification test cases

- [ ] Exact 100 TON transfer from the order wallet to the configured fee wallet with the exact `MAGROXIN:<order UUID>` comment.
- [ ] Wrong amount, wrong sender, wrong recipient, missing/wrong comment, bounced transaction, failed transaction, and out-of-window transaction are rejected.
- [ ] The same transaction cannot pay multiple orders.
- [ ] TON Center timeout, rate limiting, incomplete data, and delayed indexing remain pending or fail closed; they never mark an order paid.
- [ ] Concurrent verification requests cannot double-apply a payment.

## Deployment verification requirements

- [ ] Persist expected Jetton master address and a StateInit hash derived from the approved token parameters before prompting the wallet.
- [ ] Verify the order is paid and the connected wallet is the order wallet before deployment is prepared.
- [ ] Query a trusted TON Mainnet indexer for the exact expected master address and confirm its account is active and its deployed code/data match the expected StateInit.
- [ ] Persist a deployment status and transaction identifier idempotently; do not mark deployed from client-submitted claims alone.
- [ ] Frontend polls status with bounded retries and distinguishes pending, confirmed, and failed states.
- [ ] A failed or timed-out client request must not create duplicate deployment attempts or imply the token is live.

## Production rollout

- [ ] Run server type-check, server tests, client build, and CI.
- [ ] Review database migrations for compatibility with the existing production database.
- [ ] Verify required Render environment variables without exposing secret values.
- [ ] Deploy to Render only after the reviewed code is merged.
- [ ] Verify `/health` after deploy and confirm that the reported flags match the intended rollout.
- [ ] Perform one controlled end-to-end Mainnet test and independently inspect the payment and deployment transactions in a TON explorer.

## Safety

Never request or store a user's wallet seed phrase or private key. Do not enable production payments or deployment merely by toggling environment variables; all gates above must pass first.
