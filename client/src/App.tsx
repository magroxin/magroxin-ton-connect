
import { useMemo, useState } from "react";
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from "@tonconnect/ui-react";
import { Address } from "@ton/core";
import { prepareJettonDeployment } from "./jettonDeployment";

type Order = {
  id: string;
  walletAddress: string;
  feeTon: string;
  serviceFeeNetwork: "mainnet";
  deploymentNetwork: "mainnet";
  status: string;
  expiresAt: number;
};

type PaymentRequest = {
  ok: boolean;
  orderId: string;
  network: "-239";
  address: string;
  amountNano: string;
  payload: string;
  validUntil: number;
  paymentStatus?: string;
  error?: string;
};

type DeploymentPaymentRequest = Omit<PaymentRequest, "validUntil"> & { expiresAt: number };

type DeploymentResult = {
  address: string;
  stateInit: string;
  payload: string;
  deployValueNano: string;
  supplyUnits: string;
};

const API = (
  import.meta.env.VITE_API_BASE ||
  "https://magroxin-ton-api.onrender.com"
).replace(/\/+$/, "");

const PAID_STATUS = "PAID — VERIFIED ON-CHAIN";

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
  const [logoData, setLogoData] = useState("");
  const [logoError, setLogoError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paidStatus, setPaidStatus] = useState("");
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [deploymentEnabled, setDeploymentEnabled] = useState(false);
  const [deployment, setDeployment] =
    useState<DeploymentResult | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState("");
  const [deploymentPaymentStatus, setDeploymentPaymentStatus] = useState("UNPAID");

  const address = useTonAddress();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const isMainnet = wallet?.account.chain === "-239";
  const isPaid = paidStatus === PAID_STATUS;

  const valid = useMemo(
    () =>
      name.trim().length >= 2 &&
      /^[A-Za-z0-9._-]{2,10}$/.test(symbol.trim()) &&
      /^[1-9]\d*$/.test(supply) &&
      supply.length <= 31 &&
      Number.isInteger(Number(decimals)) &&
      Number(decimals) >= 0 &&
      Number(decimals) <= 9 &&
      (() => {
        try {
          return BigInt(supply) * 10n ** BigInt(decimals) <= 10n ** 30n;
        } catch {
          return false;
        }
      })() &&
      description.trim().length <= 1000,
    [name, symbol, supply, decimals, description]
  );

  async function createOrder() {
    if (!wallet || !address) {
      setMessage("Connect your TON wallet first.");
      return;
    }

    if (!isMainnet) {
      setMessage("Switch your wallet to TON Mainnet first.");
      return;
    }

    if (!valid || !accepted) {
      setMessage("Complete token details and accept the fee policy.");
      return;
    }

    setBusy(true);
    setMessage("");
    setOrder(null);
    setPaymentEnabled(false);
    setPaidStatus("");
    setDeployment(null);
    setDeploymentStatus("");
    setDeploymentPaymentStatus("UNPAID");

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
            ...(logoData ? { logoData } : {}),
          },
        }),
      });

      const data = await readResponse(response);

      if (!data.order?.id) {
        throw new Error("The API did not return a valid order.");
      }

      setOrder(data.order);
      const canPay =
        data.payment?.paymentRequestEnabled === true &&
        data.payment?.paymentVerificationEnabled === true;
      setPaymentEnabled(canPay);
      setPaidStatus("UNPAID");
      setMessage(
        canPay
          ? "Order created. Continue to pay the service fee."
          : "Order created, but Mainnet payment is disabled until payment verification is ready."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create order."
      );
    } finally {
      setBusy(false);
    }
  }

  function orderWalletMatchesConnectedWallet(): boolean {
    if (!address || !order?.walletAddress) return false;
    try {
      return Address.parse(address).toRawString().toLowerCase() ===
        Address.parse(order.walletAddress).toRawString().toLowerCase();
    } catch {
      return false;
    }
  }

  async function verifyPayment(
    orderId: string
  ): Promise<{ paid: boolean; deploymentEnabled: boolean }> {
    // A wallet switch or stale order must never be treated as this wallet's payment.
    setDeploymentEnabled(false);
    if (!order || order.id !== orderId || !orderWalletMatchesConnectedWallet()) {
      throw new Error("Reconnect the wallet that created this order before checking payment.");
    }

    const response = await fetch(
      `${API}/api/orders/${encodeURIComponent(orderId)}/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (
      response.ok &&
      data.status === "paid" &&
      data.paymentMarkedPaid === true
    ) {
      setPaidStatus(PAID_STATUS);
      setDeploymentEnabled(data.deploymentEnabled === true);
      setMessage(
        data.deploymentEnabled === true
          ? "Service fee verified on-chain. Deployment requires a separate wallet transaction."
          : "Service fee verified on-chain, but Mainnet token deployment is not enabled yet. No deployment transaction should be sent."
      );
      return {
        paid: true,
        deploymentEnabled: data.deploymentEnabled === true,
      };
    }

    if (response.status === 202 || data.status === "pending") {
      setPaidStatus("PAYMENT SENT — VERIFICATION PENDING");
      setMessage(
        data.message || "Payment confirmation is still pending."
      );
      return { paid: false, deploymentEnabled: false };
    }

    if (!response.ok) {
      throw new Error(data.error || "Payment verification failed.");
    }

    setPaidStatus(data.status || "UNCONFIRMED");
    setMessage(data.message || "Payment is not confirmed yet.");
    return { paid: false, deploymentEnabled: false };
  }

  async function payServiceFee() {
    if (!order || !wallet || !address || busy) return;

    if (!isMainnet) {
      setMessage("Switch your wallet to TON Mainnet first.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API}/api/orders/${encodeURIComponent(order.id)}/payment-request`
      );

      const payment = (await readResponse(response)) as PaymentRequest;

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
        throw new Error("Payment request expired. Create a new order.");
      }

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
      setMessage("Transaction submitted. Checking Mainnet confirmation...");

      const verification = await verifyPayment(order.id);

      if (!verification.paid) {
        setMessage(
          "Payment transaction submitted. On-chain verification is still pending; check again shortly."
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Transaction was not confirmed. Check your wallet."
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
        error instanceof Error ? error.message : "Could not check payment."
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyDeploymentPayment(): Promise<boolean> {
    if (!order || !address || !orderWalletMatchesConnectedWallet()) {
      throw new Error("Reconnect the wallet that created this order.");
    }
    const response = await fetch(
      `${API}/api/orders/${encodeURIComponent(order.id)}/verify-deployment-payment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.paymentMarkedPaid === true && data.status === "paid") {
      setDeploymentPaymentStatus("PAID — VERIFIED ON-CHAIN");
      setDeploymentEnabled(false);
      setMessage("Deployment cost verified. Token deployment is still disabled pending final deployment testing.");
      return true;
    }
    if (response.status === 202 || data.status === "pending") {
      setDeploymentPaymentStatus("VERIFICATION PENDING");
      setMessage(data.message || "Deployment payment verification is pending.");
      return false;
    }
    if (!response.ok) throw new Error(data.error || "Could not verify deployment payment.");
    return false;
  }

  async function payDeploymentCost() {
    if (!order || !wallet || !address || !isPaid || busy) return;
    if (!isMainnet) {
      setMessage("Switch your wallet to TON Mainnet first.");
      return;
    }
    if (!orderWalletMatchesConnectedWallet()) {
      setMessage("Reconnect the wallet that created this order.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API}/api/orders/${encodeURIComponent(order.id)}/deployment-payment-request`
      );
      const payment = (await readResponse(response)) as DeploymentPaymentRequest;
      if (!payment.address || !payment.amountNano || !payment.payload || payment.network !== "-239" || !Number.isSafeInteger(payment.expiresAt)) {
        throw new Error("The API returned an incomplete Mainnet deployment payment request.");
      }
      if (payment.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error("Deployment payment request expired. Request a fresh one before paying.");
      }
      if (!/^[1-9]\d*$/.test(payment.amountNano)) {
        throw new Error("The deployment payment amount is invalid.");
      }
      await tonConnectUI.sendTransaction({
        validUntil: payment.expiresAt,
        network: "-239",
        messages: [{ address: payment.address, amount: payment.amountNano, payload: payment.payload }],
      });
      setDeploymentPaymentStatus("TRANSACTION SUBMITTED — VERIFYING");
      setMessage("Deployment-cost transaction submitted. Checking Mainnet confirmation...");
      const paid = await verifyDeploymentPayment();
      if (!paid) setMessage("Deployment payment submitted; on-chain verification is still pending.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deployment payment was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkDeploymentPayment() {
    if (!order || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await verifyDeploymentPayment();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check deployment payment.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDeployment() {
    if (!wallet || !address || !order || !isPaid || busy) return;

    if (!deploymentEnabled) {
      setMessage("Mainnet token deployment is not enabled by the API yet.");
      return;
    }

    if (!isMainnet) {
      setMessage("Switch your wallet to TON Mainnet first.");
      return;
    }

    setBusy(true);
    setMessage("");
    setDeployment(null);
    setDeploymentStatus("");

    try {
      const result = await prepareJettonDeployment({
        adminAddress: address,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        supply,
        decimals: Number(decimals),
      });

      setDeployment(result);
      setDeploymentStatus("READY");
      setMessage(
        "Deployment prepared. Review the destination and TON amount before approving."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare token deployment."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deployToken() {
    if (!wallet || !address || !order || !deployment || busy) return;

    if (!deploymentEnabled) {
      setMessage("Mainnet token deployment is not enabled by the API yet.");
      return;
    }

    if (!isMainnet) {
      setMessage("Switch your wallet to TON Mainnet first.");
      return;
    }

    if (deploymentStatus === "SUBMITTED") return;

    setBusy(true);
    setMessage("");

    try {
      // Use the fresh return value instead of stale React state.
      const verification = await verifyPayment(order.id);

      if (!verification.paid || !verification.deploymentEnabled) {
        throw new Error(
          "Payment may be verified, but the API has not enabled token deployment. Deployment is blocked."
        );
      }

      setMessage("Review and approve the deployment transaction in your wallet.");

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: "-239",
        messages: [
          {
            address: deployment.address,
            amount: deployment.deployValueNano,
            stateInit: deployment.stateInit,
            payload: deployment.payload,
          },
        ],
      });

      setDeploymentStatus("SUBMITTED");
      setMessage(
        "Wallet submitted the deployment transaction. Submission alone does not confirm successful on-chain deployment."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Deployment was not confirmed. Check your wallet and transaction history."
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
              maxLength={100}
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
          Token logo <span className="optional">Optional · PNG, JPEG, or WebP · max 1 MB</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setLogoError("");
              setLogoData("");
              if (!file) return;
              if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                setLogoError("Choose a PNG, JPEG, or WebP image.");
                event.target.value = "";
                return;
              }
              if (file.size > 1024 * 1024) {
                setLogoError("Logo must be 1 MB or smaller.");
                event.target.value = "";
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
                  setLogoError("Could not read this image. Try another file.");
                  return;
                }
                setLogoData(reader.result);
              };
              reader.onerror = () => setLogoError("Could not read this image. Try another file.");
              reader.readAsDataURL(file);
            }}
          />
          {logoData && <img src={logoData} alt="Token logo preview" style={{ width: 88, height: 88, objectFit: "contain", marginTop: 8, borderRadius: 12 }} />}
          {logoError && <span className="hint" role="alert">{logoError}</span>}
        </label>

        <label>
          Description <span className="optional">Optional</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe your token"
            maxLength={1000}
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
            100 TON <small>fixed Mainnet service fee</small>
          </div>
        </div>

        <p className="note">
          The service fee is separate from blockchain deployment costs.
          Only approve transactions you have reviewed in your wallet.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>
            I have reviewed the service fee, separate deployment costs,
            and refund policy.
          </span>
        </label>

        <button
          className="primary"
          disabled={busy || !valid || !accepted || !wallet || !isMainnet}
          onClick={createOrder}
        >
          {busy ? "Please wait…" : "Prepare service-fee order"}
        </button>

        {!wallet && <p className="hint">Connect your TON wallet to continue.</p>}
        {wallet && !isMainnet && (
          <p className="hint">Switch your connected wallet to TON Mainnet.</p>
        )}

        {order && (
          <div className="order">
            <div className="order-top">
              <strong>Service-fee order</strong>
              <span>{order.id}</span>
            </div>

            <div className="order-amount">
              {order.feeTon} TON <small>fixed service fee</small>
            </div>

            <p className="hint">Payment status: {paidStatus || "UNPAID"}</p>

            <button
              className="primary"
              disabled={busy || isPaid || !paymentEnabled}
              onClick={payServiceFee}
            >
              {busy ? "Processing…" : paymentEnabled ? "Pay 100 TON service fee" : "Payments not enabled yet"}
            </button>

            <button
              className="secondary"
              disabled={busy || isPaid || !paymentEnabled}
              onClick={checkPayment}
            >
              Check payment status
            </button>
          </div>
        )}
      </section>

      {isPaid && order && (
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="step">03</span>
              <h2>Deploy token</h2>
            </div>
            <span className="chip">MAINNET</span>
          </div>

          <p className="note">
            Service fee verified. Blockchain deployment cost is a separate Mainnet payment.
            Pay only the exact amount and destination returned by the API.
          </p>

          <button
            className="primary"
            disabled={busy || !isPaid || !wallet || !isMainnet || deploymentPaymentStatus === "PAID — VERIFIED ON-CHAIN"}
            onClick={payDeploymentCost}
          >
            {busy ? "Processing…" : deploymentPaymentStatus === "PAID — VERIFIED ON-CHAIN" ? "Deployment cost verified" : "Pay deployment cost"}
          </button>
          <button
            className="secondary"
            disabled={busy || !isPaid || !wallet || !isMainnet}
            onClick={checkDeploymentPayment}
          >
            Check deployment payment
          </button>
          <p className="hint">Deployment payment status: {deploymentPaymentStatus}. Token deployment remains disabled until its separate final safety checks pass.</p>

          <button
            className="secondary"
            disabled={busy || !deploymentEnabled || deploymentPaymentStatus !== "PAID — VERIFIED ON-CHAIN" || deploymentStatus === "SUBMITTED"}
            onClick={prepareDeployment}
          >
            {!deploymentEnabled ? "Token deployment not enabled yet" : busy ? "Preparing…" : "Prepare deployment"}
          </button>

          {deployment && (
            <div className="order">
              <strong>Deployment review</strong>
              <p className="note">Jetton master address</p>
              <p className="message">{deployment.address}</p>

              <div className="order-amount">
                {(Number(deployment.deployValueNano) / 1e9).toFixed(3)} TON
                <small> attached deployment amount, not a gas quote</small>
              </div>

              <p className="note">
                Initial supply: {supply} {symbol.toUpperCase()}
                <br />
                Wallet: {address}
              </p>

              <p className="note">
                Token admin: your connected wallet. Unless admin rights are
                revoked or transferred, this wallet can change token metadata
                and change the admin address. This is not an immutable token.
              </p>

              <button
                className="primary"
                disabled={busy || deploymentStatus === "SUBMITTED"}
                onClick={deployToken}
              >
                {busy
                  ? "Processing…"
                  : deploymentStatus === "SUBMITTED"
                    ? "Transaction submitted"
                    : "Approve deployment in wallet"}
              </button>
            </div>
          )}

          {deploymentStatus === "SUBMITTED" && (
            <p className="note">
              Transaction submitted. Verify the transaction and token master
              address on a TON Mainnet explorer before treating deployment
              as successful.
            </p>
          )}
        </section>
      )}

      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}

      <footer>
        MAGROXIN · Secure transaction flow · Never share your wallet
        recovery phrase.
      </footer>
    </main>
  );
}
