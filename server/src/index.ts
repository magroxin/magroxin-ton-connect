
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Address, toNano } from "@ton/core";
import { z } from "zod";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || "";
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const MAINNET_FEE = Number(process.env.MAINNET_SERVICE_FEE_USD || 100);
const TESTNET_FEE = Number(process.env.TESTNET_SERVICE_FEE_USD || 1);
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";

// Deliberately disabled until payment verification has been
// independently reviewed and tested.
const PAYMENT_VERIFICATION_ENABLED = false;
const PAYMENT_REQUEST_ENABLED = false;
const DEPLOYMENT_ENABLED = false;

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

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...(process.env.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: false } }
        : {})
    })
  : null;

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

function rowToOrder(row: any): Order {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    deploymentNetwork: row.deployment_network,
    serviceFeeNetwork: "mainnet",
    feeUsd: Number(row.fee_usd),
    feeTon: String(row.fee_ton),
    amountNano: String(row.amount_nano),
    status: row.status,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ...(row.payment_tx_hash
      ? { paymentTxHash: row.payment_tx_hash }
      : {}),
    token:
      typeof row.token_data === "string"
        ? JSON.parse(row.token_data)
        : row.token_data
  };
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

async function getOrder(id: string): Promise<Order | null> {
  if (!pool) throw new Error("DATABASE_URL is not configured.");

  const result = await pool.query(
    `SELECT * FROM magroxin_orders WHERE id = $1 LIMIT 1`,
    [id]
  );

  return result.rows.length ? rowToOrder(result.rows[0]) : null;
}

async function getTonUsdPrice(): Promise<number> {
  const providers = [
    {
      name: "Binance public market data",
      url: "https://data-api.binance.vision/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any) => Number(data?.price)
    },
    {
      name: "Binance fallback",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT",
      extract: (data: any) => Number(data?.price)
    },
    {
      name: "CoinGecko",
      url: "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
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
        throw new Error("Invalid TON price");
      }

      console.log(`[MAGROXIN] Valid TON price received from ${provider.name}`);
      return price;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown error";
      errors.push(`${provider.name}: ${detail}`);
      console.warn(`[MAGROXIN] ${provider.name} failed: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`All TON price providers failed: ${errors.join("; ")}`);
}

async function initializeDatabase(): Promise<void> {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is missing. Configure it in Render Environment."
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS magroxin_orders (
      id UUID PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      deployment_network TEXT NOT NULL
        CHECK (deployment_network IN ('mainnet', 'testnet')),
      service_fee_network TEXT NOT NULL DEFAULT 'mainnet'
        CHECK (service_fee_network = 'mainnet'),
      fee_usd NUMERIC(18, 2) NOT NULL,
      fee_ton NUMERIC(30, 6) NOT NULL,
      amount_nano NUMERIC(40, 0) NOT NULL,
      status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'paid', 'expired', 'failed')),
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      payment_tx_hash TEXT UNIQUE,
      token_data JSONB NOT NULL,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS magroxin_orders_status_expiry_idx
    ON magroxin_orders (status, expires_at)
  `);

  await pool.query("SELECT 1");

  console.log("[MAGROXIN] PostgreSQL connected; schema ready");
}

app.get("/health", async (_req, res) => {
  let databaseConnected = false;

  try {
    if (pool) {
      await pool.query("SELECT 1");
      databaseConnected = true;
    }
  } catch {
    databaseConnected = false;
  }

  res.status(databaseConnected ? 200 : 503).json({
    ok: databaseConnected,
    service: "magroxin-api",
    databaseConnected,
    paymentVerificationEnabled: PAYMENT_VERIFICATION_ENABLED,
    paymentVerificationImplemented: false,
    paymentRequestEnabled: PAYMENT_REQUEST_ENABLED,
    deploymentEnabled: DEPLOYMENT_ENABLED
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

  if (!pool) {
    res.status(503).json({ error: "Database is not configured." });
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

  try {
    const tonUsdPrice = await getTonUsdPrice();
    const feeTonValue =
      Math.ceil((feeUsd / tonUsdPrice) * 1_000_000) / 1_000_000;
    const feeTon = feeTonValue.toFixed(6);
    const amountNano = toNano(feeTon).toString();
    const now = Date.now();
    const id = randomUUID();
    const expiresAt = now + 5 * 60 * 1000;

    const token = {
      name: parsed.data.token.name,
      symbol: parsed.data.token.symbol,
      supply: parsed.data.token.supply,
      decimals: parsed.data.token.decimals,
      description: parsed.data.token.description
    };

    const result = await pool.query(
      `INSERT INTO magroxin_orders
        (id, wallet_address, deployment_network, service_fee_network,
         fee_usd, fee_ton, amount_nano, status, created_at, expires_at,
         token_data)
       VALUES ($1, $2, $3, 'mainnet', $4, $5, $6, 'created', $7, $8, $9)
       RETURNING *`,
      [
        id,
        senderAddress,
        parsed.data.deploymentNetwork,
        feeUsd,
        feeTon,
        amountNano,
        now,
        expiresAt,
        JSON.stringify(token)
      ]
    );

    const order = rowToOrder(result.rows[0]);

    console.log(`[MAGROXIN] Order stored in PostgreSQL: ${order.id}`);

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      message: "Order created and saved. Payment has not been enabled."
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown order creation error";

    console.error("[MAGROXIN] Order creation error:", detail);

    res.status(503).json({
      error: "Could not create and save the order.",
      detail
    });
  }
});

// Payment requests are deliberately blocked until the complete
// payment and verification flow has been reviewed and tested.
app.get("/api/orders/:id/payment-request", (_req, res) => {
  res.status(503).json({
    error: "Payment requests are temporarily disabled.",
    paymentRequestEnabled: false,
    paymentVerificationEnabled: false,
    paymentSent: false
  });
});

// Verification is deliberately blocked. Do not mark an order paid
// until a secure, independently tested verification flow is deployed.
app.post("/api/orders/:id/verify", (_req, res) => {
  res.status(503).json({
    error: "Payment verification is temporarily disabled.",
    paymentVerificationEnabled: false,
    paymentMarkedPaid: false
  });
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await getOrder(req.params.id);

    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    res.json({
      ok: true,
      order: publicOrder(order)
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown database error";

    console.error("[MAGROXIN] Order lookup error:", detail);
    res.status(503).json({ error: "Could not retrieve order." });
  }
});

async function start(): Promise<void> {
  await initializeDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MAGROXIN] API listening on ${PORT}`);
  });
}

start().catch((error) => {
  console.error("[MAGROXIN] Startup failed:", error);
  process.exit(1);
});
