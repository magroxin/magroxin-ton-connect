# MAGROXIN TON Token Creator

MAGROXIN is a TON Mainnet Jetton-creation web app with a React/TON Connect client, an Express API, and PostgreSQL-backed orders.

## Current safety status

**Real payments and token deployment remain disabled by default. Do not enable them until the required production checks below are completed.**

- Network: TON Mainnet only.
- Current code behavior: fixed 100 TON service fee (not a live $100 USD-equivalent quote). Confirm the intended pricing before enabling payments.
- Order data: PostgreSQL; order IDs are UUIDs.
- Payment verification: server-side TON Center lookup checks sender, recipient, exact amount, order comment, time window, transaction success, and duplicate transaction use.
- Abuse controls: per-wallet order creation limit and per-order payment-verification cooldown, enforced in PostgreSQL across API instances.
- Jetton deployment: transaction preparation exists, but successful Mainnet deployment has not been validated end-to-end. The API hard-disables deployment.
- No seed phrase or private key is requested or stored.

## Before enabling real payments

1. Configure a production PostgreSQL database and back it up.
2. Configure the fee wallet and TON Center API key on the API host; independently verify the fee wallet address.
3. Set CLIENT_ORIGIN to the exact HTTPS origin serving the frontend.
4. Validate TON Center transaction response fields against real Mainnet transactions and complete end-to-end tests.
5. Add published terms, privacy, refund, and customer-support information.
6. Confirm monitoring, provider quota handling, database backups, and incident procedures.
7. Keep ENABLE_PAYMENT_REQUESTS=false and ENABLE_PAYMENT_VERIFICATION=false until all checks pass.

## Required staged Mainnet flow (in progress)

The production flow must use three server-verified stages, in this order:

1. **Service fee:** create an order bound to the connected Mainnet wallet; request the currently hardcoded 100 TON payment; verify the incoming transaction on-chain before advancing.
2. **Deployment cost:** create a separate, expiring deployment-payment request tied to the same order and wallet; verify its exact amount, destination, comment, transaction success, and uniqueness independently. A verified service-fee transaction must not satisfy this stage.
3. **Deploy and confirm:** only after both payments are verified, prepare the Jetton deployment transaction. Treat wallet submission as pending—not success—until the chain confirms the master contract and the intended initial supply is minted/transferred to the requested wallet. Persist transaction identifiers and expose a recoverable status for refreshes/retries.

**Current implementation gap:** the API now has a separate deployment-payment request and verification path, with independent ledger fields and transaction matching. However, deployment-cost payment remains disabled until the operator configures and verifies the exact recipient and nanoTON amount, and the full payment path is tested on Mainnet. `DEPLOYMENT_ENABLED` remains hardcoded to `false`; token deployment and confirmed delivery are not complete. Do not enable real payment flags as a workaround.

## Before enabling token deployment

The Jetton contracts compile in CI and committed BOCs are checked against the source. This is not a substitute for an independent contract review or an end-to-end Mainnet deployment test. Verify deployment transaction construction, attached TON amount, minting, resulting total supply, wallet address, and on-chain confirmation. Only then should the hardcoded deployment block be reconsidered.

## API configuration

See server/.env.example. In production, use the actual database URL and secrets in the hosting provider's environment settings; never commit them to Git.

Important settings:
- DATABASE_URL: required PostgreSQL connection string.
- DATABASE_SSL: set to true only when required by the database provider.
- CLIENT_ORIGIN: exact frontend origin permitted by CORS and returned in the TON Connect manifest.
- MAGROXIN_FEE_WALLET: Mainnet service-fee recipient.
- Service fee: currently hardcoded to 100 TON in `server/src/index.ts`; `MAINNET_SERVICE_FEE_USD` is not the active pricing source. Do not enable payments until the intended fee policy is confirmed and code/docs agree.
- ENABLE_PAYMENT_REQUESTS: keep false until payment flow is validated.
- ENABLE_PAYMENT_VERIFICATION: keep false until provider verification is validated.
- TONCENTER_API_KEY: provider key used for transaction lookup.
- ENABLE_DEPLOYMENT_PAYMENT: keep false until deployment-payment configuration and end-to-end Mainnet verification are complete.
- DEPLOYMENT_PAYMENT_WALLET: independently verified Mainnet recipient for the separate deployment-cost payment.
- DEPLOYMENT_PAYMENT_AMOUNT_NANO: exact positive nanoTON amount for that payment; do not guess or use a placeholder.

The API health endpoint is /health. It reports database connectivity and feature flags; a healthy response alone does not prove that payment or deployment flows are safe.

## Development

Requirements: Node.js 22+ and npm.

```sh
npm install
npm run build -w client
npm run check -w server
npm test -w server
npm run build -w server
```

GitHub Actions also compiles the Jetton contracts and verifies that the committed BOCs match the compiled sources.

## Security notes

- Never ask users for wallet recovery phrases or private keys.
- A wallet submission is not proof that a transaction succeeded on-chain.
- A fee payment must never automatically be treated as proof of token deployment.
- Do not enable deployment until the backend can verify successful deployment on-chain and the client displays a confirmed master address.
