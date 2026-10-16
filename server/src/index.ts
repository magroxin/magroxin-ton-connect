
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { beginCell, toNano, Address } from "@ton/core";
import { z } from "zod";

const app = express();
const PORT = Number(process.env.PORT || 8787);

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const VERIFY_ENABLED =
  process.env.ENABLE_PAYMENT_VERIFICATION === "true";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";
const MAINNET_FEE = Number(process.env.MAINNET_SERVICE_FEE_USD || 100);
const TESTNET_FEE = Number(process.env.TESTNET_SERVICE_FEE_USD || 1);

app.use(
  cors({
    origin: [
      CLIENT_ORIGIN,
      "https://magroxin.blogspot.com",
      "https://www.magroxin.blogspot.com"
    ]
  })
);
app.use(express.json({ limit: "32kb" }));

// Public TON Connect manifest.
app.get("/tonconnect-manifest.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");

  res.status(200).json({
    url: "https://magroxin.blogspot.com",
    name: "MAGROXIN",
    iconUrl: "https://magroxin.blogspot.com/favicon.ico"
  });
});

type Network = "mainnet" | "testnet";

type Order = {
  id: string;
  walletAddress: string;
  deploymentNetwork: Network;
  serviceFeeNetwork: "mainnet";
  feeUsd: number;
  feeTon: string;
  amountNano: string;
  status: "created" | "pending" | "paid" | "failed";
  createdAt: number;
  expiresAt: number;
  token: {
    name: string;
    symbol: string;
    supply: string;
    decimals: number;
    description: string;
  };
};

// In-memory storage only. Orders are lost when the service restarts.
const orders = new Map<string, Order>();

const orderSchema = z.object({
  walletAddress: z.string().trim().min(20).max(128),
  deploymentNetwork: z.enum(["mainnet", "testnet"]),
  token: z.object({
    name: z.string().trim().min(2).max(40),
    symbol: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/),
    supply: z.string().regex(/^[1-9][0-9]{0,29}$/),
    decimals: z.number().int().min(0).max(9),
    description: z.string().max(500).default("")
  })
});

function makeCommentPayload(comment: string): string {
  return beginCell()
    .storeUint(0, 32)
    .storeStringTail(comment)
    .endCell()
    .toBoc()
    .toString("base64");
}

async function getTonUsdPrice(): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { signal: controller.signal }
    );

    if (!response.ok) {
      throw new Error(`TON price provider returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      "the-open-network"?: { usd?: number };
    };

    const price = data["the-open-network"]?.usd;

    if (
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error("TON/USD price was missing or invalid.");
    }

    return price;
  } finally {
    clearTimeout(timer);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "magroxin-api",
    paymentVerificationEnabled: VERIFY_ENABLED,
    paymentVerificationImplemented: false,
    deploymentEnabled: false
  });
});

app.post("/api/orders", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    console.warn("[MAGROXIN] Invalid order body:", parsed.error.flatten());

    return res.status(400).json({
      error: "Invalid order details.",
      details: parsed.error.flatten()
    });
  }

  if (!FEE_WALLET) {
    return res.status(503).json({
      error: "Fee wallet is not configured on the server."
    });
  }

  if (
    !Number.isFinite(MAINNET_FEE) ||
    MAINNET_FEE <= 0 ||
    !Number.isFinite(TESTNET_FEE) ||
    TESTNET_FEE <= 0
  ) {
    return res.status(503).json({
      error: "Service fee configuration is invalid."
    });
  }

  let senderAddress: Address;
  let feeAddress: Address;

  try {
    senderAddress = Address.parse(parsed.data.walletAddress);
  } catch (error) {
    console.error("[MAGROXIN] Invalid connected wallet address:", error);

    return res.status(400).json({
      error: "The connected wallet address is invalid.",
      detail: error instanceof Error ? error.message : "Address parse failed."
    });
  }

  try {
    feeAddress = Address.parse(FEE_WALLET);
  } catch (error) {
    console.error("[MAGROXIN] Invalid server fee wallet:", error);

    return res.status(503).json({
      error: "The configured service fee wallet is invalid."
    });
  }

  // TON address parsing accepts raw and friendly addresses.
  // Keep the original connected address for order ownership checks.
  void senderAddress;
  void feeAddress;

  let tonUsd: number;

  try {
    tonUsd = await getTonUsdPrice();
  } catch (error) {
    console.error("[MAGROXIN] TON/USD quote error:", error);

    return res.status(503).json({
      error: "Unable to obtain a valid TON/USD quote.",
      detail: error instanceof Error ? error.message : "Price request failed."
    });
  }

  try {
    const feeUsd =
      parsed.data.deploymentNetwork === "mainnet"
        ? MAINNET_FEE
        : TESTNET_FEE;

    // Round up to six decimal places to avoid underquoting.
    const feeTon = (
      Math.ceil((feeUsd / tonUsd) * 1_000_000) / 1_000_000
    ).toFixed(6);

    const amountNano = toNano(feeTon).toString();
    const id = randomUUID();
    const now = Date.now();

    const order: Order = {
      id,
      walletAddress: parsed.data.walletAddress,
      deploymentNetwork: parsed.data.deploymentNetwork,
      serviceFeeNetwork: "mainnet",
      feeUsd,
      feeTon,
      amountNano,
      status: "created",
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
      token: {
        ...parsed.data.token,
        description: parsed.data.token.description || ""
      }
    };

    orders.set(id, order);

    return res.status(201).json({
      order: {
        id: order.id,
        feeUsd: order.feeUsd,
        feeTon: order.feeTon,
        serviceFeeNetwork: order.serviceFeeNetwork,
        deploymentNetwork: order.deploymentNetwork,
        status: order.status,
        expiresAt: new Date(order.expiresAt).toISOString()
      }
    });
  } catch (error) {
    console.error("[MAGROXIN] Order creation error:", error);

    return res.status(500).json({
      error: "Could not create the service-fee order.",
      detail: error instanceof Error ? error.message : "Unknown server error."
    });
  }
});

app.get("/api/orders/:id/payment-request", (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  if (order.status !== "created") {
    return res.status(409).json({
      error: "Order is not payable in its current state."
    });
  }

  if (Date.now() > order.expiresAt) {
    return res.status(410).json({
      error: "Quote expired. Create a new order."
    });
  }

  if (!FEE_WALLET) {
    return res.status(503).json({
      error: "Fee wallet is not configured."
    });
  }

  // Service fee is on Mainnet, even for a Testnet deployment.
  return res.json({
    destination: FEE_WALLET,
    amountNano: order.amountNano,
    payloadBoc: makeCommentPayload(`MAGROXIN:${order.id}`),
    network: "-239"
  });
});

app.post("/api/orders/:id/verify", async (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  if (order.status === "paid") {
    return res.json({
      status: "paid",
      message: "Payment was already verified."
    });
  }

  if (req.body?.walletAddress !== order.walletAddress) {
    return res.status(403).json({
      error: "Wallet does not match this order."
    });
  }

  if (!VERIFY_ENABLED || !TONCENTER_API_KEY) {
    return res.status(503).json({
      status: "pending",
      error:
        "Server-side payment verification is disabled until the provider adapter is implemented and tested."
    });
  }

  // Fail closed: never mark an order paid without actual server-side
  // transaction verification and comment/amount/destination matching.
  return res.status(503).json({
    status: "pending",
    error:
      "Payment verification adapter is not implemented. No payment has been marked as paid."
  });
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  return res.json({
    id: order.id,
    status: order.status,
    feeUsd: order.feeUsd,
    serviceFeeNetwork: order.serviceFeeNetwork,
    deploymentNetwork: order.deploymentNetwork,
    expiresAt: new Date(order.expiresAt).toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`MAGROXIN API listening on ${PORT}`);
});
