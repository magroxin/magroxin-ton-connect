# MAGROXIN TON Token Creator

MAGROXIN is a TON Mainnet Jetton-creation web app with a React/TON Connect client, an Express API, and PostgreSQL-backed orders.

## Current safety status

**Real payments and token deployment remain disabled by default. Do not enable them until the required production checks below are completed.**

- Network: TON Mainnet only.
- Fixed service fee: exactly 100 TON (100,000,000,000 nanoTON), separate from TON network fees.
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

## Before enabling token deployment

The Jetton contracts compile in CI and committed BOCs are checked against the source. This is not a substitute for an independent contract review or an end-to-end Mainnet deployment test. Verify deployment transaction construction, attached TON amount, minting, resulting total supply, wallet address, and on-chain confirmation. Only then should the hardcoded deployment block be reconsidered.

## API configuration

See server/.env.example. In production, use the actual database URL and secrets in the hosting provider's environment settings; never commit them to Git.

Important settings:
- DATABASE_URL: required PostgreSQL connection string.
- DATABASE_SSL: set to true only when required by the database provider.
- CLIENT_ORIGIN: exact frontend origin permitted by CORS and returned in the TON Connect manifest.
- MAGROXIN_FEE_WALLET: Mainnet service-fee recipient.
- MAINNET_SERVICE_FEE_TON: fixed service fee; must be exactly `100`.
- ENABLE_PAYMENT_REQUESTS: keep false until payment flow is validated.
- ENABLE_PAYMENT_VERIFICATION: keep false until provider verification is validated.
- TONCENTER_API_KEY: provider key used for transaction lookup.

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
