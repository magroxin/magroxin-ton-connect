import { useMemo, useState } from "react";
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

type Network = "mainnet" | "testnet";
type Order = { id: string; feeUsd: number; feeTon: string; serviceFeeNetwork: "mainnet"; deploymentNetwork: Network; status: string; expiresAt: string };
const API = (   import.meta.env.VITE_API_BASE ||   "https://magroxin-ton-api.onrender.com" ).replace(/\/+$/, "");

export default function App() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000");
  const [decimals, setDecimals] = useState("9");
  const [description, setDescription] = useState("");
  const [network, setNetwork] = useState<Network>("testnet");
  const [accepted, setAccepted] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paidStatus, setPaidStatus] = useState("");
  const address = useTonAddress();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const valid = useMemo(() => name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(symbol.trim()) &&
    Number(supply) > 0 && Number.isInteger(Number(supply)) && Number(decimals) >= 0 && Number(decimals) <= 9, [name, symbol, supply, decimals]);

  async function createOrder() {
    if (!wallet || !address) { setMessage("Connect your TON wallet first."); return; }
    if (!valid || !accepted) { setMessage("Complete token details and accept the fee policy."); return; }
    setBusy(true); setMessage(""); setOrder(null); setPaidStatus("");
    try {
      const response = await fetch(`${API}/api/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, deploymentNetwork: network, token: { name: name.trim(), symbol: symbol.trim(), supply, decimals: Number(decimals), description: description.trim() } })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create fee order.");
      setOrder(data.order);
      setMessage("Order prepared. Review the amount and approve the service-fee transaction in your wallet.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(false); }
  }

  async function payServiceFee() {
    if (!order || !wallet) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API}/api/orders/${order.id}/payment-request`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment request unavailable.");
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: "-239",
        messages: [{ address: data.destination, amount: data.amountNano, payload: data.payloadBoc }]
      });
      setMessage("Wallet submitted the transaction request. This does not yet mean payment is verified.");
      setPaidStatus("pending");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Wallet transaction was cancelled or failed."); }
    finally { setBusy(false); }
  }

  async function verifyPayment() {
    if (!order) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/orders/${order.id}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification unavailable.");
      setPaidStatus(data.status);
      setMessage(data.message || `Payment status: ${data.status}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Verification failed."); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="top"><div className="brand"><span className="mark">M</span><div><strong>MAGROXIN</strong><small>TON TOKEN CREATOR</small></div></div><TonConnectButton /></header>
    <section className="hero"><div className="eyebrow">WEB3 ASSET LAUNCHPAD</div><h1>Create your token.<br/><span>Own your launch.</span></h1><p>Prepare your Jetton details, review the service fee, and connect your TON wallet.</p></section>
    <section className="panel">
      <div className="section-head"><div><span className="step">01</span><h2>Token details</h2></div><span className="chip">{network.toUpperCase()}</span></div>
      <div className="grid">
        <label>Token name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Magroxin Token" maxLength={40}/></label>
        <label>Token symbol<input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder="e.g. MGT" maxLength={10}/></label>
        <label>Initial supply<input type="number" min="1" step="1" value={supply} onChange={e=>setSupply(e.target.value)}/></label>
        <label>Decimals<select value={decimals} onChange={e=>setDecimals(e.target.value)}><option value="9">9</option><option value="6">6</option><option value="0">0</option></select></label>
      </div>
      <label>Description <span className="optional">Optional</span><textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe your token" maxLength={500}/></label>
      <label>Deployment network<select value={network} onChange={e=>{setNetwork(e.target.value as Network);setOrder(null);setPaidStatus("");}}><option value="testnet">TON Testnet — testing</option><option value="mainnet">TON Mainnet — real assets</option></select></label>
    </section>
    <section className="panel">
      <div className="section-head"><div><span className="step">02</span><h2>Review service fee</h2></div></div>
      <div className="fee-row"><div><strong>Service fee</strong><small>{network === "mainnet" ? "Mainnet token creation" : "Testnet token creation"}</small></div><div className="fee">{network === "mainnet" ? "$100" : "$1"} <small>USD equivalent</small></div></div>
      <p className="note">The service fee is paid in <b>Mainnet TON</b> for both options. Deployment/network fees are separate and may be required later on the selected network.</p>
      <label className="check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I have reviewed the service fee, separate deployment costs, and refund policy.</span></label>
      <button className="primary" disabled={busy || !valid || !accepted || !wallet} onClick={createOrder}>{busy ? "Please wait…" : "Prepare service-fee order"}</button>
      {!wallet && <p className="hint">Connect your TON wallet to continue.</p>}
      {order && <div className="order">
        <div className="order-top"><strong>Order ready</strong><span>{order.id}</span></div>
        <div className="order-amount">{order.feeTon} TON <small>estimated quote</small></div>
        <p className="note">This quote must be checked against the live rate and expiry before production use. Payment verification is disabled by default in this starter repository.</p>
        <button className="primary" disabled={busy} onClick={payServiceFee}>Approve service-fee payment in wallet</button>
        <button className="secondary" disabled={busy || paidStatus !== "pending"} onClick={verifyPayment}>Check payment status</button>
        {paidStatus && <p className="hint">Status: {paidStatus}</p>}
      </div>}
      {message && <p className="message" role="status">{message}</p>}
    </section>
    <footer>MAGROXIN · Secure transaction flow · Never share your wallet recovery phrase.</footer>
  </main>;
}
