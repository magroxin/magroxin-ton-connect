
import { useMemo, useState } from "react";
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from "@tonconnect/ui-react";

type Order = {
  id: string;
  feeUsd: number;
  feeTon: string;
  serviceFeeNetwork: "mainnet";
  deploymentNetwork: "mainnet";
  status: string;
  expiresAt: string;
};

const API = (
  import.meta.env.VITE_API_BASE ||
  "https://magroxin-ton-api.onrender.com"
).replace(/\/+$/, "");

export default function App() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000");
  const [decimals, setDecimals] = useState("9");
  const [description, setDescription] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paidStatus, setPaidStatus] = useState("");

  const address = useTonAddress();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const valid = useMemo(
    () =>
      name.trim().length >= 2 &&
      /^[A-Za-z0-9]{2,10}$/.test(symbol.trim()) &&
      Number(supply) > 0 &&
      Number.isSafeInteger(Number(supply)) &&
      Number(decimals) >= 0 &&
      Number(decimals) <= 9,
    [name, symbol, supply, decimals]
  );

  async function createOrder() {
    if (!wallet || !address) {
      setMessage("Connect your TON wallet first.");
      return;
    }

    if (!valid || !accepted) {
      setMessage("Complete token details and accept the fee policy.");
      return;
    }

    setBusy(true);
    setMessage("");
    setOrder(null);
    setPaidStatus("");

    try {
      const response = await fetch(`${API}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          deploymentNetwork: "mainnet",
          token: {
            name: name.trim(),
            symbol: symbol.trim(),
            supply,
            decimals: Number(decimals),
            description: description.trim(),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not create fee order.");
      }

      setOrder(data.order);
      setMessage(
        "Order prepared. No payment has been made or verified."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Request failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function payServiceFee() {
    if (!order || !wallet) return;

    setMessage(
      "Payment is currently disabled while payment verification is being tested. No transaction was sent."
    );
  }

  async function verifyPayment() {
    if (!order) return;

    setMessage(
      "Payment verification is currently disabled. This order is not confirmed as paid."
    );
  }

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark">M</span>
          <div>
            <strong>MAGROXIN</strong>
            <small>TON TOKEN CREATOR</small>
          </div>
        </div>
        <TonConnectButton />
      </header>

      <section className="hero">
        <div className="eyebrow">WEB3 ASSET LAUNCHPAD</div>
        <h1>
          Create your token.
          <br />
          <span>Own your launch.</span>
        </h1>
        <p>
          Prepare your Jetton details, review the service fee,
          and connect your TON wallet.
        </p>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="step">01</span>
            <h2>Token details</h2>
          </div>
          <span className="chip">MAINNET</span>
        </div>

        <div className="grid">
          <label>
            Token name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Magroxin Token"
              maxLength={40}
            />
          </label>

          <label>
            Token symbol
            <input
              value={symbol}
              onChange={(event) =>
                setSymbol(event.target.value.toUpperCase())
              }
              placeholder="e.g. MGT"
              maxLength={10}
            />
          </label>

          <label>
            Initial supply
            <input
              type="number"
              min="1"
              step="1"
              value={supply}
              onChange={(event) => setSupply(event.target.value)}
            />
          </label>

          <label>
            Decimals
            <select
              value={decimals}
              onChange={(event) => setDecimals(event.target.value)}
            >
              <option value="9">9</option>
              <option value="6">6</option>
              <option value="0">0</option>
            </select>
          </label>
        </div>

        <label>
          Description <span className="optional">Optional</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe your token"
            maxLength={500}
          />
        </label>

        <label>
          Deployment network
          <select value="mainnet" disabled>
            <option value="mainnet">TON Mainnet — real assets</option>
          </select>
        </label>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="step">02</span>
            <h2>Review service fee</h2>
          </div>
        </div>

        <div className="fee-row">
          <div>
            <strong>Service fee</strong>
            <small>Mainnet token creation</small>
          </div>
          <div className="fee">
            $100 <small>USD equivalent</small>
          </div>
        </div>

        <p className="note">
          The service fee is payable in Mainnet TON when payment
          processing is enabled. Blockchain deployment costs are
          separate. Payment and token deployment are currently disabled.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>
            I have reviewed the service fee, separate deployment
            costs, and refund policy.
          </span>
        </label>

        <button
          className="primary"
          disabled={busy || !valid || !accepted || !wallet}
          onClick={createOrder}
        >
          {busy ? "Please wait…" : "Prepare service-fee order"}
        </button>

        {!wallet && (
          <p className="hint">Connect your TON wallet to continue.</p>
        )}

        {order && (
          <div className="order">
            <div className="order-top">
              <strong>Order prepared — unpaid</strong>
              <span>{order.id}</span>
            </div>

            <div className="order-amount">
              {order.feeTon} TON <small>estimated quote</small>
            </div>

            <p className="note">
              This is an order, not a completed payment. The amount
              is an estimate. Payment verification and deployment
              have not been enabled.
            </p>

            <button
              className="primary"
              disabled={busy}
              onClick={payServiceFee}
            >
              Service-fee payment unavailable
            </button>

            <button
              className="secondary"
              disabled={busy}
              onClick={verifyPayment}
            >
              Check payment status
            </button>

            {paidStatus && (
              <p className="hint">Status: {paidStatus}</p>
            )}
          </div>
        )}

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </section>

      <footer>
        MAGROXIN · Secure transaction flow · Never share your wallet
        recovery phrase.
      </footer>
    </main>
  );
}
