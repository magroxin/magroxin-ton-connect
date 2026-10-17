
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

type PaymentRequest = {
  ok: boolean;
  orderId: string;
  network: "-239";
  address: string;
  amountNano: string;
  payload: string;
  validUntil: number;
  error?: string;
};

const API = (
  import.meta.env.VITE_API_BASE ||
  "https://magroxin-ton-api.onrender.com"
).replace(/\/+$/, "");

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed (${response.status}).`
    );
  }

  return data;
}

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
            symbol: symbol.trim().toUpperCase(),
            supply,
            decimals: Number(decimals),
            description: description.trim(),
          },
        }),
      });

      const data = await readResponse(response);

      if (!data.order?.id) {
        throw new Error("The API did not return a valid order.");
      }

      setOrder(data.order);
      setPaidStatus("UNPAID");
      setMessage(
        "Order created. Continue to your wallet to pay the service fee."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create order."
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(orderId: string) {
    const response = await fetch(
      `${API}/api/orders/${encodeURIComponent(orderId)}/verify`,
      { method: "POST" }
    );

    const data = await response.json().catch(() => ({}));

    if (data.status === "paid" && data.paymentMarkedPaid === true) {
      setPaidStatus("PAID — VERIFIED ON-CHAIN");
      setMessage(
        "Service fee verified. Token deployment is still a separate step."
      );
      return;
    }

    if (response.status === 202 || data.status === "pending") {
      setPaidStatus("PAYMENT SENT — VERIFICATION PENDING");
      setMessage(
        data.message ||
          "The payment has not been confirmed by the API yet. Check again shortly."
      );
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || "Payment verification failed.");
    }

    setPaidStatus(data.status || "UNCONFIRMED");
    setMessage(data.message || "Payment is not confirmed yet.");
  }

  async function payServiceFee() {
    if (!order || !wallet || !address || busy) return;

    setBusy(true);
    setMessage("");
    
    try {
      const requestResponse = await fetch(
        `${API}/api/orders/${encodeURIComponent(order.id)}/payment-request`
      );

      const payment = (await readResponse(
        requestResponse
      )) as PaymentRequest;

      if (
        !payment.address ||
        !payment.amountNano ||
        !payment.payload ||
        !payment.validUntil
      ) {
        throw new Error("The API returned an incomplete payment request.");
      }

      if (payment.network !== "-239") {
        throw new Error("This order is not configured for TON Mainnet.");
      }

      if (payment.validUntil <= Math.floor(Date.now() / 1000)) {
        throw new Error("This payment request has expired. Create a new order.");
      }

      setMessage("Approve the $100 service-fee transaction in your wallet.");

      await tonConnectUI.sendTransaction({
        validUntil: payment.validUntil,
        network: "-239",
        messages: [
          {
            address: payment.address,
            amount: payment.amountNano,
            payload: payment.payload,
          },
        ],
      });

      setPaidStatus("TRANSACTION SUBMITTED — VERIFYING");
      setMessage(
        "Wallet submitted the transaction. Checking Mainnet confirmation..."
      );

      await verifyPayment(order.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Transaction was not confirmed. Check your wallet before retrying."
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkPayment() {
    if (!order || busy) return;

    setBusy(true);
    setMessage("");

    try {
      await verifyPayment(order.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not check payment status."
      );
    } finally {
      setBusy(false);
    }
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
          The service fee is paid separately from blockchain deployment
          costs. The TON amount is calculated by the API. Only approve a
          transaction after reviewing its destination and amount in your wallet.
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
              <strong>Service-fee order</strong>
              <span>{order.id}</span>
            </div>

            <div className="order-amount">
              {order.feeTon} TON <small>estimated quote</small>
            </div>

            <p className="hint">Payment status: {paidStatus || "UNPAID"}</p>

            <button
              className="primary"
              disabled={busy || paidStatus === "PAID — VERIFIED ON-CHAIN"}
              onClick={payServiceFee}
            >
              {busy ? "Processing…" : "Pay $100 service fee"}
            </button>

            <button
              className="secondary"
              disabled={busy || paidStatus === "PAID — VERIFIED ON-CHAIN"}
              onClick={checkPayment}
            >
              Check payment status
            </button>

            {paidStatus === "PAID — VERIFIED ON-CHAIN" && (
              <p className="note">
                The service fee is verified. Token deployment is not yet
                enabled, and no token has been deployed by this page.
              </p>
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
