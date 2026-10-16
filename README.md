# MAGROXIN TON Connect

Starter repository for the MAGROXIN token-creation flow. It contains a React/TON Connect client, a small Express API, fee/order configuration, and a clear integration boundary for Jetton deployment.

## Important status

This repository is a **starter implementation, not a production-ready token launch service**. Payment verification is intentionally disabled by default. Do not enable Mainnet payments until you have deployed the API over HTTPS, configured a TON provider key, implemented and tested provider-specific transaction/comment decoding, and completed end-to-end tests. The Jetton deployment step is intentionally a separate next integration; do not tell users a token was deployed merely because a fee transaction was submitted.

## Fee rules

- Mainnet token creation service fee: $100 equivalent in **Mainnet TON**.
- Testnet token creation service fee: $1 equivalent in **Mainnet TON**.
- Jetton deployment costs are separate and paid on the selected deployment network.
- The receiving address is configured server-side in `server/.env`, not displayed in the UI.
- Do not use a user's wallet seed phrase. TON Connect never needs it.

## Requirements

- Node.js 20+
- A public HTTPS host for the frontend and API in production
- A publicly accessible HTTPS `tonconnect-manifest.json`
- A TON Center API key for production transaction lookup/verification
- Legal/fee/refund policy pages before collecting real funds

## Local setup

1. Copy `.env.example` to `server/.env`.
2. Review the fee wallet address and network settings carefully.
3. Install packages from the repository root: `npm install`
4. Run locally: `npm run dev`
5. Open `http://localhost:5173`.

The wallet manifest is at `client/public/tonconnect-manifest.json`. Update its `url`, icon, terms and privacy URLs before deployment. TON Connect wallets require the manifest to be publicly accessible over HTTPS in production.

## What currently works

- Token details form and review screen
- TON Connect wallet UI
- Separate service-fee order creation
- Explicit wallet transaction request with unique order reference
- API endpoint structure for payment verification
- Fee/network rules kept separate from the visible UI

## Not production-complete yet

- Provider-specific transaction verification is deliberately disabled by default; the API refuses to mark a payment paid until configured.
- Live USD-to-TON conversion needs a trusted, time-sensitive price source and a documented quote expiry.
- Jetton minter/wallet contract compilation, audit, deploy transaction construction, minting and end-to-end testing are not included as a claimed working feature.
- Persist orders in a database before launch; the included in-memory store is lost on restart.
- Add rate limiting, monitoring, abuse prevention, terms/privacy pages and operational support.

## Suggested production architecture

Frontend (TON Connect) -> authenticated API -> persistent database -> TON provider transaction verification -> one-time paid order state -> user-approved deployment transaction on selected network.

Never accept a frontend success callback as proof of payment. Verify destination, sender, amount, chain, order reference, transaction finality and duplicate processing on the server.
