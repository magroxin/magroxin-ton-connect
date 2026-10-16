
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Address, beginCell, Cell, toNano } from "@ton/core";
import { z } from "zod";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";
const VERIFY_ENABLED =
  process.env.ENABLE_PAYMENT_VERIFICATION === "true";

const MAINNET_FEE = Number(
  process.env.MAINNET_SERVICE_FEE_USD || 100
);
const TESTNET_FEE = Number(
  process.env.TESTNET_SERVICE_FEE_USD || 1
);
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";

const allowedOrigins = new Set([
  CLIENT_ORIGIN,
  "https://magroxin.blogspot.com",
  "https://www.magroxin.blogspot.com"
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed by MAGROXIN API"));
      }
    }
  })
);

app.use(express.json({ limit: "2mb" }));

type Network = "mainnet" | "testnet";
type OrderStatus = "created" | "paid" | "expired" | "failed";

type Order = {
  id: string;
  walletAddress: string;
  deploymentNetwork: Network;
  serviceFeeNetwork: "mainnet";
  feeUsd: number;
  feeTon: string;
  amountNano: string;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  paymentTxHash?: string;
  token: {
    name: string;
    symbol: string;
    supply: string;
    decimals: number;
    description: string;
  };
};

type TonMessage = {
  source?: string | null;
  destination?: string | null;
  value?: string | number | null;
  bounced?: boolean;
  message_content?: {
    body?: string | null;
    decoded?: unknown;
  } | null;
};

type TonTransaction = {
  hash?: string;
  now?: number;
  description?: {
    aborted?: boolean;
  };
  in_msg?: TonMessage | null;
};

const orders = new Map<string, Order>();

// In-memory protection only. Use a persistent database before production.
const usedPaymentTransactions = new Map<string, string>();

const orderSchema = z.object({
  walletAddress: z.string().min(20).max(128),
  deploymentNetwork: z.enum(["mainnet", "testnet"]),
  token: z.object({
    name: z.string().trim().min(2).max(40),
    symbol: z.string().regex(/^[A-Za-z0-9]{2,10}$/),
    supply: z.string().regex(/^[1-9][0-9]{0,29}$/),
    decimals: z.number().int().min(0).max(9),
    description: z.string().max(500).default("")
  })
});

function normalizeAddress(value: string): string {
  return Address.parse(value).toRawString().toLowerCase();
}

function makeCommentPayload(orderId: string): string {
  return beginCell()
    .storeUint(0, 32)
    .storeStringTail(`MAGROXIN:${orderId}`)
    .endCell()
    .toBoc()
    .toString("base64");
}

function readPaymentComment(message: TonMessage): string {
  const body = message.message_content?.body;

  if (!body) return "";

  try {
    const slice = Cell.fromBase64(body).beginParse();

    if (slice.remainingBits < 32) return "";

    const opcode = slice.loadUint(32);

    // A standard TON text comment begins with opcode 0.
    if (opcode !== 0) return "";

    return slice.loadStringTail();
  } catch {
    return "";
  }
}

/**
 * Fetch a market quote.
 * TONUSDT is a USD-equivalent quote, not a guaranteed exact USD price.
 */
async function getTonUsdPrice(): Promise<number> {
  const providers = [
    {
      name: "Binance",
      url:
        "https://data-api.binance.vision/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any) => Number(data?.price)
    },
    {
      name: "Binance fallback",
      url:
        "https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any) => Number(data?.price)
    },
    {
      name: "CoinGecko",
      url:
        "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      extract: (data: any) => Number(data?.["the-open-network"]?.usd)
    }
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(provider.url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const price = provider.extract(data);

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Invalid price");
      }

      console.log(`[MAGROXIN] TON quote received from ${provider.name}`);
      return price;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[MAGROXIN] ${provider.name} failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`All TON price providers failed: ${errors.join("; ")}`);
}

function publicOrder(order: Order) {
  return {
    id: order.id,
    walletAddress: order.walletAddress,
    deploymentNetwork: order.deploymentNetwork,
    serviceFeeNetwork: order.serviceFeeNetwork,
    feeUsd: order.feeUsd,
    feeTon: order.feeTon,
    amountNano: order.amountNano,
    status: order.status,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    ...(order.paymentTxHash
      ? { paymentTxHash: order.paymentTxHash }
      : {}),
    token: order.token
  };
}

async function getMainnetTransactions(
  order: Order
): Promise<TonTransaction[]> {
  if (!TONCENTER_API_KEY) {
    throw new Error("TONCENTER_API_KEY is not configured.");
  }

  const feeWalletRaw = normalizeAddress(FEE_WALLET);
  const url = new URL("https://toncenter.com/api/v3/transactions");

  url.searchParams.set("account", feeWalletRaw);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  url.searchParams.set("sort", "desc");
  url.searchParams.set(
    "start_utime",
    String(Math.max(0, Math.floor(order.createdAt / 1000) - 30))
  );

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-Key": TONCENTER_API_KEY
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`TON Center returned HTTP ${response.status}`);
  }

  const data: any = await response.json();

  if (!Array.isArray(data?.transactions)) {
    throw new Error("Unexpected TON Center transaction response.");
  }

  return data.transactions as TonTransaction[];
}

function findMatchingPayment(
  order: Order,
  transactions: TonTransaction[]
): TonTransaction | undefined {
  const expectedWallet = normalizeAddress(FEE_WALLET);
  const expectedSender = normalizeAddress(order.walletAddress);
  const requiredAmount = BigInt(order.amountNano);
  const requiredComment = `MAGROXIN:${order.id}`;

  return transactions.find((tx) => {
    const message = tx.in_msg;

    if (!message || message.bounced === true) return false;
    if (tx.description?.aborted === true) return false;
    if (!tx.hash) return false;

    // Reject transactions dated before this order was created.
    const transactionTime = Number(tx.now || 0);
    if (
      transactionTime > 0 &&
      transactionTime < Math.floor(order.createdAt / 1000) - 30
    ) {
      return false;
    }

    try {
      if (!message.destination || !message.source) return false;

      if (normalizeAddress(message.destination) !== expectedWallet) {
        return false;
      }

      if (normalizeAddress(message.source) !== expectedSender) {
        return false;
      }
    } catch {
      return false;
    }

    if (readPaymentComment(message) !== requiredComment) {
      return false;
    }

    let received: bigint;

    try {
      received = BigInt(String(message.value ?? "0"));
    } catch {
      return false;
    }

    if (received < requiredAmount) return false;

    const txKey = tx.hash.toLowerCase();
    const usedBy = usedPaymentTransactions.get(txKey);

    // One transaction cannot pay multiple orders.
    if (usedBy && usedBy !== order.id) return false;

    return true;
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "magroxin-api",
    paymentVerificationEnabled: VERIFY_ENABLED,
    paymentVerificationImplemented: true,
    deploymentEnabled: false,
    tonCenterKeyConfigured: Boolean(TONCENTER_API_KEY)
  });
});

app.get("/tonconnect-manifest.json", (_req, res) => {
  res.json({
    url: "https://magroxin.blogspot.com",
    name: "MAGROXIN",
    iconUrl: "https://magroxin.blogspot.com/favicon.ico"
  });
});

app.post("/api/orders", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid order details.",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  if (!FEE_WALLET) {
    res.status(503).json({
      error: "MAGROXIN service-fee wallet is not configured."
    });
    return;
  }

  let senderAddress: string;

  try {
    senderAddress = normalizeAddress(parsed.data.walletAddress);
    normalizeAddress(FEE_WALLET);
  } catch {
    res.status(400).json({ error: "Invalid TON wallet address." });
    return;
  }

  const feeUsd =
    parsed.data.deploymentNetwork === "mainnet"
      ? MAINNET_FEE
      : TESTNET_FEE;

  if (!Number.isFinite(feeUsd) || feeUsd <= 0) {
    res.status(503).json({ error: "Service fee configuration is invalid." });
    return;
  }

  let tonUsdPrice: number;

  try {
    tonUsdPrice = await getTonUsdPrice();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown price error";

    console.error("[MAGROXIN] TON quote error:", detail);
    res.status(503).json({
      error: "Unable to obtain a valid TON/USD quote.",
      detail
    });
    return;
  }

  const feeTonValue =
    Math.ceil((feeUsd / tonUsdPrice) * 1_000_000) / 1_000_000;

  const feeTon = feeTonValue.toFixed(6);
  const amountNano = toNano(feeTon).toString();
  const now = Date.now();

  const order: Order = {
    id: randomUUID(),
    walletAddress: senderAddress,
    deploymentNetwork: parsed.data.deploymentNetwork,
    serviceFeeNetwork: "mainnet",
    feeUsd,
    feeTon,
    amountNano,
    status: "created",
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000,
    token: {
      name: parsed.data.token.name,
      symbol: parsed.data.token.symbol,
      supply: parsed.data.token.supply,
      decimals: parsed.data.token.decimals,
      description: parsed.data.token.description
    }
  };

  orders.set(order.id, order);

  res.status(201).json({
    ok: true,
    order: publicOrder(order)
  });
});

app.get("/api/orders/:id/payment-request", (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  if (order.status !== "created") {
    res.status(409).json({ error: "Order is not awaiting payment." });
    return;
  }

  if (Date.now() > order.expiresAt) {
    order.status = "expired";
    res.status(410).json({ error: "Order expired. Create a new order." });
    return;
  }

  res.json({
    ok: true,
    orderId: order.id,
    to: FEE_WALLET,
    amountNano: order.amountNano,
    payload: makeCommentPayload(order.id),
    network: "-239"
  });
});

app.post("/api/orders/:id/verify", async (req, res) => {
  if (!VERIFY_ENABLED) {
    res.status(503).json({
      error: "Payment verification is disabled.",
      paymentVerificationEnabled: false,
      paymentVerificationImplemented: true,
      paymentMarkedPaid: false
    });
    return;
  }

  if (!TONCENTER_API_KEY) {
    res.status(503).json({
      error: "TON Center API key is not configured."
    });
    return;
  }

  if (!FEE_WALLET) {
    res.status(503).json({
      error: "MAGROXIN service-fee wallet is not configured."
    });
    return;
  }

  const order = orders.get(req.params.id);

  if (!order) {
    res.status(404).json({
      error: "Order not found. It may have been lost after a server restart."
    });
    return;
  }

  if (order.status === "paid") {
    res.json({
      ok: true,
      paid: true,
      status: "paid",
      orderId: order.id,
      paymentTxHash: order.paymentTxHash
    });
    return;
  }

  if (order.status !== "created") {
    res.status(409).json({
      error: "Order is not awaiting payment.",
      status: order.status
    });
    return;
  }

  try {
    const transactions = await getMainnetTransactions(order);
    const payment = findMatchingPayment(order, transactions);

    if (!payment || !payment.hash) {
      res.status(200).json({
        ok: true,
        paid: false,
        status: order.status,
        message:
          "No matching Mainnet payment found yet. No payment status was changed."
      });
      return;
    }

    const txKey = payment.hash.toLowerCase();
    const alreadyUsedBy = usedPaymentTransactions.get(txKey);

    if (alreadyUsedBy && alreadyUsedBy !== order.id) {
      res.status(409).json({
        error: "This transaction has already been assigned to another order."
      });
      return;
    }

    usedPaymentTransactions.set(txKey, order.id);
    order.status = "paid";
    order.paymentTxHash = payment.hash;

    console.log(
      `[MAGROXIN] Payment verified for order ${order.id}; transaction ${payment.hash}`
    );

    res.json({
      ok: true,
      paid: true,
      status: "paid",
      orderId: order.id,
      paymentTxHash: payment.hash,
      message:
        "Matching Mainnet payment found. This does not deploy the token."
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown verification error";

    console.error("[MAGROXIN] Verification error:", detail);

    res.status(502).json({
      error: "Could not verify payment with TON Center.",
      detail,
      paymentMarkedPaid: false
    });
  }
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  res.json({
    ok: true,
    order: publicOrder(order)
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[MAGROXIN] API listening on ${PORT}`);
});
