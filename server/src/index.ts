
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Address, beginCell, toNano } from "@ton/core";
import { z } from "zod";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const VERIFY_ENABLED =
  process.env.ENABLE_PAYMENT_VERIFICATION === "true";
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";

const MAINNET_FEE = Number(
  process.env.MAINNET_SERVICE_FEE_USD || 100
);
const TESTNET_FEE = Number(
  process.env.TESTNET_SERVICE_FEE_USD || 1
);

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
  token: {
    name: string;
    symbol: string;
    supply: string;
    decimals: number;
    description: string;
  };
};

const orders = new Map<string, Order>();

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

function makeCommentPayload(orderId: string): string {
  return beginCell()
    .storeUint(0, 32)
    .storeStringTail(`MAGROXIN:${orderId}`)
    .endCell()
    .toBoc()
    .toString("base64");
}

/**
 * Retrieves a fresh TON market price.
 *
 * Binance TONUSDT is used as a USD-equivalent quote.
 * USDT can trade slightly above or below USD.
 * CoinGecko is a fallback.
 *
 * No hardcoded TON price is used.
 * Orders fail closed if every provider fails.
 */
async function getTonUsdPrice(): Promise<number> {
  const providers = [
    {
      name: "Binance public market data",
      url:
        "https://data-api.binance.vision/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any): number =>
        Number(data?.price)
    },
    {
      name: "Binance API fallback",
      url:
        "https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any): number =>
        Number(data?.price)
    },
    {
      name: "CoinGecko",
      url:
        "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      extract: (data: any): number =>
        Number(data?.["the-open-network"]?.usd)
    }
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      console.log(
        `[MAGROXIN] Requesting TON price from ${provider.name}`
      );

      const response = await fetch(provider.url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();
      const price = provider.extract(data);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw new Error("Price missing or invalid");
      }

      console.log(
        `[MAGROXIN] Valid TON price received from ${provider.name}`
      );

      return price;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";

      errors.push(`${provider.name}: ${message}`);

      console.warn(
        `[MAGROXIN] ${provider.name} failed: ${message}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `All TON price providers failed. ${errors.join("; ")}`
  );
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
    token: order.token
  };
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

  const feeUsd =
    parsed.data.deploymentNetwork === "mainnet"
      ? MAINNET_FEE
      : TESTNET_FEE;

  if (!Number.isFinite(feeUsd) || feeUsd <= 0) {
    res.status(503).json({
      error: "Service fee configuration is invalid."
    });
    return;
  }

  try {
    Address.parse(parsed.data.walletAddress);
    Address.parse(FEE_WALLET);
  } catch {
    res.status(400).json({
      error: "Invalid TON wallet address."
    });
    return;
  }

  let tonUsdPrice: number;

  try {
    tonUsdPrice = await getTonUsdPrice();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown price error";

    console.error("[MAGROXIN] TON price error:", detail);

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
    walletAddress: parsed.data.walletAddress,
    deploymentNetwork: parsed.data.deploymentNetwork,

    // Service fees are always requested on TON Mainnet.
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
    res.status(409).json({
      error: "This order is not awaiting payment."
    });
    return;
  }

  if (Date.now() > order.expiresAt) {
    order.status = "expired";

    res.status(410).json({
      error: "Order expired. Create a new order."
    });
    return;
  }

  res.json({
    ok: true,
    orderId: order.id,
    to: FEE_WALLET,
    amountNano: order.amountNano,
    payload: makeCommentPayload(order.id),

    // -239 means TON Mainnet.
    network: "-239"
  });
});

app.post("/api/orders/:id/verify", (_req, res) => {
  // Verification is not implemented.
  // Never mark an order paid without actual verification.
  res.status(503).json({
    error: "Payment verification is not implemented yet.",
    paymentVerificationEnabled: VERIFY_ENABLED,
    paymentVerificationImplemented: false,
    paymentMarkedPaid: false
  });
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
