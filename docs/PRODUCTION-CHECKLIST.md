# Production checklist — do not skip

- [ ] Replace in-memory order storage with a persistent database and unique transaction-hash constraint.
- [ ] Add request rate limits, structured logs, security headers, API timeouts and monitoring.
- [ ] Set the correct production origin and deploy the API over HTTPS.
- [ ] Update the TON Connect manifest to the final public HTTPS domain and valid PNG icon.
- [ ] Implement a TON provider adapter and test parsing inbound transactions, sender, destination, exact nanogram amount, comment payload, chain, confirmations/finality and duplicate hashes.
- [ ] Reconcile order references from actual on-chain transaction data; never trust client-submitted hashes alone.
- [ ] Implement reliable USD/TON quote source, caching, quote expiry, source timestamp and rounding policy.
- [ ] Add explicit terms, privacy, refund policy and support contact.
- [ ] Build and audit the Jetton minter/wallet contract; test metadata, mint supply, decimals, ownership and recipient.
- [ ] Implement user-approved deployment transaction on selected network only after service-fee verification.
- [ ] Ensure testnet service fee still goes to Mainnet while testnet deployment cost uses Testnet TON.
- [ ] Test failure, cancel, stale quote, underpayment, overpayment, replay, duplicate callback and server restart.
- [ ] Keep all wallet secrets out of the browser and repository.
- [ ] Start with testnet; do not enable real payments until independent end-to-end testing passes.
