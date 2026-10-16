
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Address, toNano } from "@ton/core";
import { z } from "zod";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || "";
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";

const MAINNET_FEE = Number(process.env.MAINNET_SERVICE_FEE_USD || 100);
const TESTNET_FEE = Number(process.env.TESTNET_SERVICE_FEE_USD || 1);

// Keep payments and deployment disabled until independently tested.
const PAYMENT_REQUEST_ENABLED = false;
const PAYMENT_VERIFICATION_ENABLED = false;
const DEPLOYMENT_ENABLED = false;

type Network = "mainnet" | "testnet";
type OrderStatus = "created" | "paid" | "expired" | "failed";

interface Order {
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
  paymentTxHash?: string | null;
  token: {
    name: string;
    symbol: string;
    supply: string;
    decimals: number;
    description: string;
  };
}

if (!DATABASE_URL) {
  console.error("[MAGROXIN] DATABASE_URL is missing.");
}

const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ...(process.env.DATABASE_SSL === "true"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        origin === CLIENT_ORIGIN ||
        origin.endsWith(".blogspot.com")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed by CORS."));
      }
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

const orderSchema = z.object({
  walletAddress: z.string().min(10).max(150),
  deploymentNetwork: z.enum(["mainnet", "testnet"]),
  token: z.object({
    name: z.string().trim().min(1).max(100),
    symbol: z.string().trim().min(1).max(20),
    supply: z.string().trim().regex(/^\d+(\.\d+)?$/).max(80),
    decimals: z.number().int().min(0).max(18),
    description: z.string().max(1000).optional().default(""),
  }),
});

function normalizeAddress(value: string): string {
  return Address.parse(value).toRawString().toLowerCase();
}

function rowToOrder(row: Record<string, any>): Order {
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
    paymentTxHash: row.payment_tx_hash ?? null,
    token:
      typeof row.token_data === "string"
        ? JSON.parse(row.token_data)
        : row.token_data,
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
    paymentTxHash: order.paymentTxHash ?? null,
    token: order.token,
  };
}

async function getOrder(id: string): Promise<Order | null> {
  const result = await pool.query(
    `SELECT * FROM magroxin_orders WHERE id = $1 LIMIT 1`,
    [id],
  );

  return result.rows[0] ? rowToOrder(result.rows[0]) : null;
}

async function getTonUsdPrice(): Promise<number> {
  const urls = [
    "https://data-api.binance.vision/api/v3/ticker/price?symbol=TONUSDT",
    "https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT",
    "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        if (!response.ok) continue;

        const data: any = await response.json();
        const price =
          typeof data.price === "string" || typeof data.price === "number"
            ? Number(data.price)
            : Number(data?.["the-open-network"]?.usd);

        if (Number.isFinite(price) && price > 0) {
          console.log("[MAGROXIN] Valid TON/USD quote received.");
          return price;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Try the next public price source.
    }
  }

  throw new Error("Unable to obtain a valid TON/USD quote.");
}

async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS magroxin_orders (
      id UUID PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      deployment_network TEXT NOT NULL
        CHECK (deployment_network IN ('mainnet', 'testnet')),
      service_fee_network TEXT NOT NULL DEFAULT 'mainnet'
        CHECK (service_fee_network = 'mainnet'),
      fee_usd NUMERIC(12, 2) NOT NULL,
      fee_ton NUMERIC(30, 6) NOT NULL,
      amount_nano NUMERIC(40, 0) NOT NULL,
      status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'paid', 'expired', 'failed')),
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      payment_tx_hash TEXT UNIQUE,
      token_data JSONB NOT NULL,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      magroxin_orders_status_expiry_idx
    ON magroxin_orders (status, expires_at);
  `);

  console.log("[MAGROXIN] PostgreSQL initialized.");
}

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "magroxin-api",
      databaseConnected: true,
      paymentRequestEnabled: PAYMENT_REQUEST_ENABLED,
      paymentVerificationEnabled: PAYMENT_VERIFICATION_ENABLED,
      paymentVerificationImplemented: false,
      deploymentEnabled: DEPLOYMENT_ENABLED,
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: "magroxin-api",
      databaseConnected: false,
      paymentRequestEnabled: false,
      paymentVerificationEnabled: false,
      deploymentEnabled: false,
    });
  }
});

app.get("/tonconnect-manifest.json", (_req: Request, res: Response) => {
  res.json({
    url: CLIENT_ORIGIN,
    name: "MAGROXIN",
    iconUrl: `${CLIENT_ORIGIN}/favicon.ico`,
  });
});

app.post("/api/orders", async (req: Request, res: Response) => {
  try {
    const parsed = orderSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order details.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (!DATABASE_URL) {
      return res.status(503).json({
        ok: false,
        error: "Order database is not configured.",
      });
    }

    if (!FEE_WALLET) {
      return res.status(503).json({
        ok: false,
        error: "Service fee configuration is incomplete.",
      });
    }

    // Validate configuration privately; never return the fee destination.
    try {
      Address.parse(FEE_WALLET);
    } catch {
      console.error("[MAGROXIN] Fee wallet configuration is invalid.");
      return res.status(503).json({
        ok: false,
        error: "Service fee configuration is invalid.",
      });
    }

    let walletAddress: string;

    try {
      walletAddress = normalizeAddress(parsed.data.walletAddress);
    } catch {
      return res.status(400).json({
        ok: false,
        error: "Invalid TON wallet address.",
      });
    }

    const deploymentNetwork = parsed.data.deploymentNetwork;
    const feeUsd =
      deploymentNetwork === "mainnet" ? MAINNET_FEE : TESTNET_FEE;

    if (!Number.isFinite(feeUsd) || feeUsd <= 0) {
      return res.status(503).json({
        ok: false,
        error: "Service fee configuration is invalid.",
      });
    }

    const tonUsd = await getTonUsdPrice();

    // Round to six decimal places for the displayed TON quote.
    const feeTon = (feeUsd / tonUsd).toFixed(6);
    const amountNano = toNano(feeTon).toString();

    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;
    const id = randomUUID();

    const token = {
      name: parsed.data.token.name,
      symbol: parsed.data.token.symbol,
      supply: parsed.data.token.supply,
      decimals: parsed.data.token.decimals,
      description: parsed.data.token.description ?? "",
    };

    const result = await pool.query(
      `INSERT INTO magroxin_orders (
        id,
        wallet_address,
        deployment_network,
        service_fee_network,
        fee_usd,
        fee_ton,
        amount_nano,
        status,
        created_at,
        expires_at,
        token_data
      )
      VALUES ($1, $2, $3, 'mainnet', $4, $5, $6, 'created', $7, $8, $9)
      RETURNING *`,
      [
        id,
        walletAddress,
        deploymentNetwork,
        feeUsd,
        feeTon,
        amountNano,
        now,
        expiresAt,
        JSON.stringify(token),
      ],
    );

    const order = rowToOrder(result.rows[0]);

    return res.status(201).json({
      ok: true,
      order: publicOrder(order),
      payment: {
        status: "not_requested",
        paymentRequestEnabled: PAYMENT_REQUEST_ENABLED,
        paymentVerificationEnabled: PAYMENT_VERIFICATION_ENABLED,
        paymentSent: false,
        message:
          "Order created. No payment has been requested or sent.",
      },
      deployment: {
        enabled: DEPLOYMENT_ENABLED,
        message: "Token deployment is not available yet.",
      },
    });
  } catch (error) {
    console.error(
      "[MAGROXIN] Order creation failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    if (
      error instanceof Error &&
      error.message === "Unable to obtain a valid TON/USD quote."
    ) {
      return res.status(503).json({
        ok: false,
        error: "Unable to obtain a valid TON/USD quote.",
        paymentSent: false,
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Order creation failed.",
      paymentSent: false,
    });
  }
});

app.get(
  "/api/orders/:id/payment-request",
  async (req: Request, res: Response) => {
    // Fail closed: do not provide a transaction payload until
    // payment verification has been implemented and tested.
    return res.status(503).json({
      ok: false,
      error: "Payment requests are temporarily disabled.",
      paymentRequestEnabled: false,
      paymentVerificationEnabled: false,
      paymentSent: false,
    });
  },
);

app.post(
  "/api/orders/:id/verify",
  async (_req: Request, res: Response) => {
    // Never trust a client to mark an order as paid.
    return res.status(503).json({
      ok: false,
      error: "Payment verification is not implemented yet.",
      paymentVerificationEnabled: false,
      paymentMarkedPaid: false,
    });
  },
);

app.get("/api/orders/:id", async (req: Request, res: Response) => {
  try {

app.get("/api/orders/:id", async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;

    if (typeof orderId !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID.",
      });
    }

    const order = await getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found.",
      });
    }

    return res.json({
      ok: true,
      order: publicOrder(order),
    });
  } catch (error) {
    console.error(
      "[MAGROXIN] Order lookup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve order.",
    });
  }
});

async function start(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  await initializeDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MAGROXIN] API listening on port ${PORT}`);
    console.log("[MAGROXIN] Payment requests: disabled");
    console.log("[MAGROXIN] Payment verification: disabled");
    console.log("[MAGROXIN] Token deployment: disabled");
  });
}

start().catch((error) => {
  console.error(
    "[MAGROXIN] Startup failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
