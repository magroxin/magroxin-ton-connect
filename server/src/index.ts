import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { beginCell, toNano, Address } from "@ton/core";
import { z } from "zod";

const app = express();

app.get("/tonconnect-manifest.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");

  res.status(200).json({
    url: "https://magroxin.blogspot.com",
    name: "MAGROXIN",
    iconUrl: "https://magroxin.blogspot.com/favicon.ico"
  });
});

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const VERIFY_ENABLED = process.env.ENABLE_PAYMENT_VERIFICATION === "true";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";
const MAINNET_FEE = Number(process.env.MAINNET_SERVICE_FEE_USD || 100);
const TESTNET_FEE = Number(process.env.TESTNET_SERVICE_FEE_USD || 1);

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "32kb" }));

type Network = "mainnet" | "testnet";
type Order = {
  id: string; walletAddress: string; deploymentNetwork: Network; serviceFeeNetwork: "mainnet";
  feeUsd: number; feeTon: string; amountNano: string; status: "created" | "pending" | "paid" | "failed";
  createdAt: number; expiresAt: number; token: { name: string; symbol: string; supply: string; decimals: number; description: string };
};
const orders = new Map<string, Order>(); // Replace with a persistent database before production.

const orderSchema = z.object({
  walletAddress: z.string().min(20).max(128),
  deploymentNetwork: z.enum(["mainnet", "testnet"]),
  token: z.object({
    name: z.string().trim().min(2).max(40),
    symbol: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/),
    supply: z.string().regex(/^[1-9][0-9]{0,29}$/),
    decimals: z.number().int().min(0).max(9),
    description: z.string().max(500).default("")
  })
});

function makeCommentPayload(comment: string) {
  return beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString("base64");
}

async function getTonUsdPrice(): Promise<number> {
  // Production must use a trusted rate source with timeouts, caching, and quote audit records.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd", { signal: controller.signal });
    if (!response.ok) throw new Error("Price provider unavailable.");
    const data = await response.json() as { "the-open-network"?: { usd?: number } };
    const price = data["the-open-network"]?.usd;
    if (!price || !Number.isFinite(price) || price <= 0) throw new Error("Invalid TON/USD price.");
    return price;
  } finally { clearTimeout(timer); }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "magroxin-api", paymentVerificationEnabled: VERIFY_ENABLED }));

app.post("/api/orders", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order details." });
  if (!FEE_WALLET) return res.status(503).json({ error: "Fee wallet is not configured on the server." });
  try {
    Address.parse(parsed.data.walletAddress);
    Address.parse(FEE_WALLET);
    const feeUsd = parsed.data.deploymentNetwork === "mainnet" ? MAINNET_FEE : TESTNET_FEE;
    const tonUsd = await getTonUsdPrice();
    // Round upward to avoid underpayment; quote expires after 5 minutes.
    const feeTon = (Math.ceil((feeUsd / tonUsd) * 1e6) / 1e6).toFixed(6);
    const amountNano = toNano(feeTon).toString();
    const id = randomUUID();
    const now = Date.now();
    const order: Order = {
      id, walletAddress: parsed.data.walletAddress, deploymentNetwork: parsed.data.deploymentNetwork,
      serviceFeeNetwork: "mainnet", feeUsd, feeTon, amountNano, status: "created",
      createdAt: now, expiresAt: now + 5 * 60 * 1000,
      token: { ...parsed.data.token, description: parsed.data.token.description || "" }
    };
    orders.set(id, order);
    return res.json({ order: { id, feeUsd, feeTon, serviceFeeNetwork: "mainnet", deploymentNetwork: order.deploymentNetwork, status: order.status, expiresAt: new Date(order.expiresAt).toISOString() } });
  } catch {
    return res.status(400).json({ error: "Wallet address or TON quote is invalid." });
  }
});

app.get("/api/orders/:id/payment-request", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.status !== "created") return res.status(409).json({ error: "Order is not payable in its current state." });
  if (Date.now() > order.expiresAt) return res.status(410).json({ error: "Quote expired. Prepare a new order." });
  if (!FEE_WALLET) return res.status(503).json({ error: "Fee wallet is not configured." });
  // Payment always occurs on Mainnet, even when the token deployment network is Testnet.
  return res.json({ destination: FEE_WALLET, amountNano: order.amountNano, payloadBoc: makeCommentPayload(`MAGROXIN:${order.id}`), network: "-239" });
});

app.post("/api/orders/:id/verify", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.status === "paid") return res.json({ status: "paid", message: "Payment was already verified." });
  if (req.body?.walletAddress !== order.walletAddress) return res.status(403).json({ error: "Wallet does not match this order." });
  if (!VERIFY_ENABLED || !TONCENTER_API_KEY) {
    return res.status(503).json({ status: "pending", error: "Server-side payment verification is disabled until the TON provider adapter is configured and tested." });
  }
  // Intentionally fail closed: provider transaction/comment decoding is not enabled in this starter.
  // Never mark an order paid based on a browser callback or an unverified explorer response.
  return res.status(503).json({ status: "pending", error: "Payment verification adapter is not implemented. No payment has been marked as paid." });
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  return res.json({ id: order.id, status: order.status, feeUsd: order.feeUsd, serviceFeeNetwork: order.serviceFeeNetwork, deploymentNetwork: order.deploymentNetwork });
});

app.listen(PORT, () => console.log(`MAGROXIN API listening on ${PORT}`));
