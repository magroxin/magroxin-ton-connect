
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Address, beginCell, Cell, toNano } from "@ton/core";
import { z } from "zod";
import { matchIncomingPaymentTransaction, parseTransactionPage } from "./paymentTransactionMatcher.js";
import { getApiRateLimitRule, hashRateLimitClientKey } from "./apiRateLimit.js";
import { isSupportedJettonSupply } from "./tokenSupply.js";
import { readDeploymentPaymentConfig } from "./deploymentPaymentConfig.js";

const app = express();

// Render terminates HTTPS in front of the service; trust only its immediate proxy hop for client IPs.
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || "";
const FEE_WALLET = process.env.MAGROXIN_FEE_WALLET || "";
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "https://magroxin.blogspot.com";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";
const TONCENTER_V3 = "https://toncenter.com/api/v3";

const MAINNET_SERVICE_FEE_TON = "100";
const MAINNET_SERVICE_FEE_NANO = "100000000000";

const PAYMENT_REQUEST_ENABLED =
  process.env.ENABLE_PAYMENT_REQUESTS === "true";

const PAYMENT_VERIFICATION_ENABLED =
  process.env.ENABLE_PAYMENT_VERIFICATION === "true";

// Keep deployment disabled until the complete deployment flow is tested.
const DEPLOYMENT_ENABLED = false;
const DEPLOYMENT_PAYMENT_CONFIG = readDeploymentPaymentConfig(process.env);

const ORDER_LIFETIME_MS = 5 * 60 * 1000;
const PAYMENT_GRACE_SECONDS = 120;

type OrderStatus = "created" | "paid" | "expired" | "failed";

interface TokenData {
  name: string;
  symbol: string;
  supply: string;
  decimals: number;
  description: string;
  logoData?: string;
}

interface Order {
  id: string;
  walletAddress: string;
  deploymentNetwork: "mainnet";
  serviceFeeNetwork: "mainnet";
  feeUsd: number;
  feeTon: string;
  amountNano: string;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  paymentTxHash: string | null;
  token: TokenData;
}

const orderSchema = z.object({
  walletAddress: z.string().min(10).max(150),
  deploymentNetwork: z.literal("mainnet"),
  token: z.object({
    name: z.string().trim().min(2).max(100),
    symbol: z.string().trim().regex(/^[A-Za-z0-9._-]{2,10}$/),
    supply: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/)
      .max(31),
    decimals: z.number().int().min(0).max(9),
    description: z.string().max(1000).optional().default(""),
    logoData: z.string().max(1400000).optional().default(""),
  }).superRefine((token, ctx) => {
    if (!isSupportedJettonSupply(token.supply, token.decimals)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supply"],
        message: "Token supply or decimals are outside the supported limit.",
      });
    }
  }),
});

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

// Baseline security headers for API responses. HSTS is intentionally omitted
// here because HTTPS termination is managed by the production hosting proxy.
app.use((_req: Request, res: Response, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === CLIENT_ORIGIN) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed by CORS."));
      }
    },
  }),
);

app.use(express.json({ limit: "2mb" }));

let rateLimitCleanupCounter = 0;

app.use(async (req: Request, res: Response, next) => {
  const path = req.originalUrl.split("?")[0] || req.path;
  const rule = getApiRateLimitRule(req.method, path);
  if (!rule) return next();

  const now = Date.now();
  const windowStart = Math.floor(now / (rule.windowSeconds * 1000)) * rule.windowSeconds;
  const clientKey = hashRateLimitClientKey(req.ip || "unknown", rule.scope);

  try {
    const result = await pool.query(
      `INSERT INTO magroxin_rate_limits
         (window_start, scope, client_key, request_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (window_start, scope, client_key)
       DO UPDATE SET request_count = magroxin_rate_limits.request_count + 1
       RETURNING request_count`,
      [windowStart, rule.scope, clientKey],
    );

    const count = Number(result.rows[0]?.request_count ?? rule.maxRequests + 1);
    const remaining = Math.max(0, rule.maxRequests - count);
    const resetSeconds = Math.max(
      1,
      rule.windowSeconds - Math.floor((now / 1000) % rule.windowSeconds),
    );
    res.setHeader("RateLimit-Limit", String(rule.maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (count > rule.maxRequests) {
      res.setHeader("Retry-After", String(resetSeconds));
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Please wait before trying again.",
      });
    }

    // Periodically prune old buckets without adding a cleanup query to every request.
    rateLimitCleanupCounter += 1;
    if (rateLimitCleanupCounter % 1000 === 0) {
      void pool.query(
        "DELETE FROM magroxin_rate_limits WHERE window_start < $1",
        [windowStart - 3600],
      ).catch(() => {});
    }

    return next();
  } catch {
    // Fail closed for endpoints that can create orders or trigger payment lookups.
    return res.status(503).json({
      ok: false,
      error: "Request protection is temporarily unavailable. Please retry shortly.",
    });
  }
});

function normalizeAddress(value: string): string {
  return Address.parse(value).toRawString().toLowerCase();
}

function paymentComment(orderId: string): string {
  return `MAGROXIN:${orderId}`;
}

function validOrderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function rowToOrder(row: Record<string, any>): Order {
  const token: TokenData =
    typeof row.token_data === "string"
      ? JSON.parse(row.token_data)
      : row.token_data;

  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    deploymentNetwork: "mainnet",
    serviceFeeNetwork: "mainnet",
    feeUsd: Number(row.fee_usd),
    feeTon: String(row.fee_ton),
    amountNano: String(row.amount_nano),
    status: row.status as OrderStatus,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    paymentTxHash: row.payment_tx_hash ?? null,
    token,
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
    paymentTxHash: order.paymentTxHash,
    token: order.token,
  };
}

async function getOrder(id: string): Promise<Order | null> {
  const result = await pool.query(
    "SELECT * FROM magroxin_orders WHERE id = $1 LIMIT 1",
    [id],
  );

  return result.rows[0] ? rowToOrder(result.rows[0]) : null;
}

async function expireOrderIfNeeded(order: Order): Promise<Order> {
  if (
    order.status === "created" &&
    Date.now() >=
      order.expiresAt + PAYMENT_GRACE_SECONDS * 1000
  ) {
    const result = await pool.query(
      `UPDATE magroxin_orders
       SET status = 'expired'
       WHERE id = $1 AND status = 'created'
       RETURNING *`,
      [order.id],
    );

    if (result.rows[0]) {
      return rowToOrder(result.rows[0]);
    }

    return (await getOrder(order.id)) || order;
  }

  return order;
}

function decodeComment(body: unknown): string | null {
  if (typeof body !== "string" || !body) return null;

  try {
    const cell = Cell.fromBase64(body);
    const slice = cell.beginParse();

    if (slice.remainingBits < 32) return null;
    if (slice.loadUint(32) !== 0) return null;

    return slice.loadStringTail();
  } catch {
    return null;
  }
}

/**
 * Fail closed: missing or incomplete transaction data
 * must never be treated as successful payment.
 */

async function findVerifiedPayment(
  order: Order,
): Promise<{ hash: string } | null> {
  if (!TONCENTER_API_KEY || !FEE_WALLET) {
    throw new Error("Payment verification is not configured.");
  }

  const recipient = normalizeAddress(FEE_WALLET);
  const sender = normalizeAddress(order.walletAddress);
  const expectedAmount = BigInt(order.amountNano);
  const expectedComment = paymentComment(order.id);

  const start = Math.floor(order.createdAt / 1000);
  const end =
    Math.floor(order.expiresAt / 1000) +
    PAYMENT_GRACE_SECONDS;

  const pageSize = 1000;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${TONCENTER_V3}/transactions`);

    url.searchParams.set("account", recipient);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("start_utime", String(start));
    url.searchParams.set("end_utime", String(end));

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": TONCENTER_API_KEY,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(
        `TON Center returned HTTP ${response.status}.`,
      );
    }

    const data: unknown = await response.json();

    const pageData = parseTransactionPage(data, pageSize);
    const transactions = pageData.transactions as any[];

    for (const tx of transactions) {
      const match = matchIncomingPaymentTransaction(
        tx,
        {
          sender,
          recipient,
          expectedAmount,
          start,
          end,
          expectedComment,
        },
        { normalizeAddress, decodeComment },
      );

      if (match) return match;
    }

    if (!pageData.hasMore) {
      return null;
    }
  }

  throw new Error(
    "Transaction search limit reached; verification is inconclusive.",
  );
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
      last_verification_at BIGINT,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE magroxin_orders
    ADD COLUMN IF NOT EXISTS last_verification_at BIGINT;
  `);

  // Staged payment ledger fields are persisted independently. They remain
  // unused until a separate on-chain verifier is wired and tested.
  await pool.query(`
    ALTER TABLE magroxin_orders
    ADD COLUMN IF NOT EXISTS deployment_payment_status TEXT NOT NULL DEFAULT 'created'
      CHECK (deployment_payment_status IN ('created', 'paid', 'expired', 'failed')),
    ADD COLUMN IF NOT EXISTS deployment_payment_tx_hash TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS deployment_payment_amount_nano NUMERIC(40, 0),
    ADD COLUMN IF NOT EXISTS deployment_payment_expires_at BIGINT,
    ADD COLUMN IF NOT EXISTS deployment_payment_last_verification_at BIGINT,
    ADD COLUMN IF NOT EXISTS deployment_started_at BIGINT,
    ADD COLUMN IF NOT EXISTS deployment_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS token_delivery_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS magroxin_orders_status_expiry_idx
    ON magroxin_orders (status, expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS magroxin_rate_limits (
      window_start BIGINT NOT NULL,
      scope TEXT NOT NULL,
      client_key TEXT NOT NULL,
      request_count INTEGER NOT NULL CHECK (request_count > 0),
      PRIMARY KEY (window_start, scope, client_key)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS magroxin_rate_limits_window_idx
    ON magroxin_rate_limits (window_start);
  `);

  console.log("[MAGROXIN] PostgreSQL initialized.");
}

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");

    return res.json({
      ok: true,
      service: "magroxin-api",
      databaseConnected: true,
      network: "mainnet",
      serviceFeeTon: MAINNET_SERVICE_FEE_TON,
      paymentRequestEnabled: PAYMENT_REQUEST_ENABLED,
      paymentVerificationEnabled: PAYMENT_VERIFICATION_ENABLED,
      paymentVerificationImplemented: true,
      deploymentEnabled: DEPLOYMENT_ENABLED,
      deploymentPaymentConfigured: DEPLOYMENT_PAYMENT_CONFIG.enabled,
    });
  } catch {
    return res.status(503).json({
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
  return res.json({
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
        error: "Invalid order details. Mainnet is the only supported network.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (!DATABASE_URL || !FEE_WALLET) {
      return res.status(503).json({
        ok: false,
        error: "Service configuration is incomplete.",
      });
    }

    try {
      Address.parse(FEE_WALLET);
    } catch {
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

    const logoData = parsed.data.token.logoData ?? "";
    if (logoData && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logoData)) {
      return res.status(400).json({ ok: false, error: "Logo must be a PNG, JPEG, or WebP data image." });
    }
    const feeTon = MAINNET_SERVICE_FEE_TON;
    const amountNano = MAINNET_SERVICE_FEE_NANO;

    const now = Date.now();
    const expiresAt = now + ORDER_LIFETIME_MS;
    const id = randomUUID();

    const token: TokenData = {
      name: parsed.data.token.name,
      symbol: parsed.data.token.symbol,
      supply: parsed.data.token.supply,
      decimals: parsed.data.token.decimals,
      description: parsed.data.token.description ?? "",
      ...(logoData ? { logoData } : {}),
    };

    // Apply a shared PostgreSQL-backed per-wallet limit. Advisory locking keeps
    // concurrent requests from bypassing the count on multiple Render instances.
    const client = await pool.connect();
    let transactionOpen = false;
    let result;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [walletAddress],
      );

      const recent = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM magroxin_orders
         WHERE wallet_address = $1
           AND created_on >= NOW() - INTERVAL '1 hour'`,
        [walletAddress],
      );

      if (Number(recent.rows[0]?.count ?? 0) >= 5) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(429).json({
          ok: false,
          error: "Order limit reached for this wallet. Try again later.",
          paymentSent: false,
        });
      }

      result = await client.query(
        `INSERT INTO magroxin_orders (
          id, wallet_address, deployment_network,
          service_fee_network, fee_usd, fee_ton,
          amount_nano, status, created_at, expires_at, token_data
        )
        VALUES ($1, $2, 'mainnet', 'mainnet', $3, $4, $5,
                'created', $6, $7, $8)
        RETURNING *`,
        [
          id,
          walletAddress,
          100,
          feeTon,
          amountNano,
          now,
          expiresAt,
          JSON.stringify(token),
        ],
      );

      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original error.
        }
      }
      throw error;
    } finally {
      client.release();
    }

    const order = rowToOrder(result.rows[0]);

    return res.status(201).json({
      ok: true,
      order: publicOrder(order),
      payment: {
        status: "not_requested",
        paymentRequestEnabled: PAYMENT_REQUEST_ENABLED,
        paymentVerificationEnabled: PAYMENT_VERIFICATION_ENABLED,
        paymentSent: false,
        message: "Order created. No payment has been requested or sent.",
      },
      deployment: {
        enabled: false,
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
      error.message.includes("TON/USD")
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
    try {
      if (
        !PAYMENT_REQUEST_ENABLED ||
        !PAYMENT_VERIFICATION_ENABLED ||
        !TONCENTER_API_KEY ||
        !FEE_WALLET
      ) {
        return res.status(503).json({
          ok: false,
          error: "Payment is disabled pending end-to-end testing.",
          paymentSent: false,
        });
      }

      const id = req.params.id;

      if (!validOrderId(id)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid order ID.",
        });
      }

      let order = await getOrder(id);

      if (!order) {
        return res.status(404).json({
          ok: false,
          error: "Order not found.",
        });
      }

      order = await expireOrderIfNeeded(order);

      if (order.status !== "created") {
        return res.status(409).json({
          ok: false,
          error: "Order is not awaiting payment.",
        });
      }

      if (Date.now() >= order.expiresAt) {
        return res.status(410).json({
          ok: false,
          error: "Order expired. Create a new order.",
        });
      }

      const feeAddress = Address.parse(FEE_WALLET).toString({
        bounceable: true,
        urlSafe: true,
      });

      const payload = beginCell()
        .storeUint(0, 32)
        .storeStringTail(paymentComment(order.id))
        .endCell()
        .toBoc()
        .toString("base64");

      return res.json({
        ok: true,
        orderId: order.id,
        network: "-239",
        address: feeAddress,
        amountNano: order.amountNano,
        payload,
        validUntil: Math.floor(order.expiresAt / 1000),
        paymentRequestEnabled: true,
        paymentVerificationEnabled: true,
      });
    } catch (error) {
      console.error(
        "[MAGROXIN] Payment request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      return res.status(503).json({
        ok: false,
        error: "Unable to create payment request.",
        paymentSent: false,
      });
    }
  },
);

app.post(
  "/api/orders/:id/verify",
  async (req: Request, res: Response) => {
    const id = req.params.id;

    if (!validOrderId(id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID.",
        paymentMarkedPaid: false,
      });
    }

    if (
      !PAYMENT_REQUEST_ENABLED ||
      !PAYMENT_VERIFICATION_ENABLED ||
      !TONCENTER_API_KEY ||
      !FEE_WALLET
    ) {
      return res.status(503).json({
        ok: false,
        error: "Payment verification is disabled.",
        paymentMarkedPaid: false,
      });
    }

    let order: Order | null;

    try {
      order = await getOrder(id);
    } catch {
      return res.status(503).json({
        ok: false,
        error: "Unable to retrieve order.",
        paymentMarkedPaid: false,
      });
    }

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found.",
        paymentMarkedPaid: false,
      });
    }

    // Require the caller to identify the wallet attached to the order before
    // exposing payment status or initiating a TON Center scan.
    let submittedWalletAddress: string;
    try {
      if (typeof req.body?.walletAddress !== "string") {
        throw new Error("Missing wallet address.");
      }
      submittedWalletAddress = normalizeAddress(req.body.walletAddress);
    } catch {
      return res.status(400).json({
        ok: false,
        error: "A valid connected wallet address is required.",
        paymentMarkedPaid: false,
      });
    }

    if (submittedWalletAddress !== normalizeAddress(order.walletAddress)) {
      return res.status(403).json({
        ok: false,
        error: "Connected wallet does not match this order.",
        paymentMarkedPaid: false,
      });
    }

    if (order.status === "paid") {
      return res.json({
        ok: true,
        status: "paid",
        paymentMarkedPaid: true,
        paymentTxHash: order.paymentTxHash,
        deploymentEnabled: false,
      });
    }

    if (order.status !== "created") {
      return res.status(409).json({
        ok: false,
        error: "Order is not awaiting payment.",
        paymentMarkedPaid: false,
      });
    }

    if (
      Date.now() >=
      order.expiresAt + PAYMENT_GRACE_SECONDS * 1000
    ) {
      const expired = await expireOrderIfNeeded(order);

      return res.status(410).json({
        ok: false,
        status: expired.status,
        error: "Order expired. Create a new order.",
        paymentMarkedPaid: false,
      });
    }

    // Throttle provider lookups per order across all API instances.
    // The conditional update is atomic, so simultaneous requests cannot all
    // start expensive TON Center scans for the same order.
    const verificationWindowStart = Date.now();
    let verificationClaim;

    try {
      verificationClaim = await pool.query(
        `UPDATE magroxin_orders
         SET last_verification_at = $2
         WHERE id = $1
           AND status = 'created'
           AND (
             last_verification_at IS NULL OR
             last_verification_at <= $3
           )
         RETURNING id`,
        [id, verificationWindowStart, verificationWindowStart - 30000],
      );
    } catch {
      return res.status(503).json({
        ok: false,
        error: "Unable to prepare payment verification.",
        paymentMarkedPaid: false,
      });
    }

    if (verificationClaim.rowCount !== 1) {
      return res.status(429).json({
        ok: false,
        error: "Payment was checked recently. Wait 30 seconds before checking again.",
        paymentMarkedPaid: false,
      });
    }

    let payment: { hash: string } | null;

    try {
      payment = await findVerifiedPayment(order);
    } catch (error) {
      console.error(
        "[MAGROXIN] TON Center lookup failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      return res.status(503).json({
        ok: false,
        error: "Unable to verify payment right now.",
        paymentMarkedPaid: false,
      });
    }

    if (!payment) {
      return res.status(202).json({
        ok: true,
        status: "pending",
        paymentMarkedPaid: false,
        message: "No matching successful payment was found yet.",
      });
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const updated = await client.query(
        `UPDATE magroxin_orders
         SET status = 'paid', payment_tx_hash = $1
         WHERE id = $2
           AND status = 'created'
           AND payment_tx_hash IS NULL
           AND expires_at >= $3`,
        [
          payment.hash,
          id,
          Date.now() - PAYMENT_GRACE_SECONDS * 1000,
        ],
      );

      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        const latest = await getOrder(id);

        if (latest?.status === "paid") {
          return res.json({
            ok: true,
            status: "paid",
            paymentMarkedPaid: true,
            paymentTxHash: latest.paymentTxHash,
            deploymentEnabled: false,
          });
        }

        return res.status(409).json({
          ok: false,
          error: "Order status changed or expired. Refresh the order.",
          paymentMarkedPaid: false,
        });
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return res.json({
        ok: true,
        status: "paid",
        paymentMarkedPaid: true,
        paymentTxHash: payment.hash,
        deploymentEnabled: false,
        message: "Service fee verified. Token deployment is not enabled.",
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original error.
        }
      }

      const pgError = error as { code?: string };

      if (pgError.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "This transaction has already been used for an order.",
          paymentMarkedPaid: false,
        });
      }

      console.error(
        "[MAGROXIN] Payment update failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      return res.status(503).json({
        ok: false,
        error: "Unable to update payment status.",
        paymentMarkedPaid: false,
      });
    } finally {
      client.release();
    }
  },
);


function deploymentPaymentComment(orderId: string): string {
  return `MAGROXIN-DEPLOY:${orderId}`;
}

async function findVerifiedDeploymentPayment(
  order: Order,
): Promise<{ hash: string } | null> {
  if (!TONCENTER_API_KEY || !DEPLOYMENT_PAYMENT_CONFIG.enabled) {
    throw new Error("Deployment payment verification is not configured.");
  }

  const recipient = normalizeAddress(DEPLOYMENT_PAYMENT_CONFIG.recipient);
  const sender = normalizeAddress(order.walletAddress);
  const expectedAmount = BigInt(DEPLOYMENT_PAYMENT_CONFIG.amountNano);
  const expectedComment = deploymentPaymentComment(order.id);
  // The second payment occurs after the service fee; use its own persisted deadline.
  const ledger = await pool.query(
    "SELECT deployment_payment_expires_at FROM magroxin_orders WHERE id = $1",
    [order.id],
  );
  const deploymentExpiresAt = Number(ledger.rows[0]?.deployment_payment_expires_at);
  if (!Number.isSafeInteger(deploymentExpiresAt) || deploymentExpiresAt <= 0) {
    throw new Error("Deployment payment deadline has not been initialized.");
  }
  const start = Math.floor(order.createdAt / 1000);
  const end = Math.floor(deploymentExpiresAt / 1000);
  const pageSize = 1000;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${TONCENTER_V3}/transactions`);
    url.searchParams.set("account", recipient);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("start_utime", String(start));
    url.searchParams.set("end_utime", String(end));

    const response = await fetch(url, {
      headers: { accept: "application/json", "X-API-Key": TONCENTER_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`TON Center returned HTTP ${response.status}.`);

    const pageData = parseTransactionPage(await response.json(), pageSize);
    for (const tx of pageData.transactions as any[]) {
      const match = matchIncomingPaymentTransaction(
        tx,
        { sender, recipient, expectedAmount, start, end, expectedComment },
        { normalizeAddress, decodeComment },
      );
      if (match) return match;
    }
    if (!pageData.hasMore) return null;
  }
  throw new Error("Deployment payment transaction search limit reached; verification is inconclusive.");
}

app.get("/api/orders/:id/deployment-payment-request", async (req: Request, res: Response) => {
  try {
    if (!DEPLOYMENT_PAYMENT_CONFIG.enabled || !TONCENTER_API_KEY) {
      return res.status(503).json({ ok: false, error: "Deployment-cost payment is disabled pending configuration and end-to-end testing.", paymentSent: false });
    }
    const id = req.params.id;
    if (!validOrderId(id)) return res.status(400).json({ ok: false, error: "Invalid order ID." });
    const order = await getOrder(id);
    if (!order) return res.status(404).json({ ok: false, error: "Order not found." });
    if (order.status !== "paid") return res.status(409).json({ ok: false, error: "Verify the 100 TON service fee before requesting deployment payment." });

    const ledger = await pool.query("SELECT deployment_payment_status, deployment_payment_tx_hash FROM magroxin_orders WHERE id = $1", [id]);
    if (ledger.rows[0]?.deployment_payment_status === "paid") {
      return res.status(409).json({ ok: false, error: "Deployment payment is already verified." });
    }

    let recipient;
    try { recipient = Address.parse(DEPLOYMENT_PAYMENT_CONFIG.recipient).toString({ bounceable: true, urlSafe: true }); }
    catch { return res.status(503).json({ ok: false, error: "Deployment payment wallet configuration is invalid." }); }

    // Give the second payment its own 15-minute window, independent of the
    // short service-fee order expiry. Preserve the first deadline on retries.
    const paymentDeadline = Date.now() + 15 * 60 * 1000;
    const deadlineResult = await pool.query(
      `UPDATE magroxin_orders
       SET deployment_payment_expires_at = COALESCE(deployment_payment_expires_at, $2)
       WHERE id = $1 AND status = 'paid'
       RETURNING deployment_payment_expires_at`,
      [id, paymentDeadline],
    );
    const deploymentPaymentExpiresAt = Number(deadlineResult.rows[0]?.deployment_payment_expires_at);
    if (!Number.isSafeInteger(deploymentPaymentExpiresAt) || deploymentPaymentExpiresAt <= Date.now()) {
      return res.status(409).json({ ok: false, error: "Deployment payment request has expired. Contact support before retrying.", paymentSent: false });
    }

    const payload = beginCell().storeUint(0, 32).storeStringTail(deploymentPaymentComment(order.id)).endCell().toBoc().toString('base64');
    return res.json({
      ok: true, orderId: order.id, network: "-239", address: recipient,
      amountNano: DEPLOYMENT_PAYMENT_CONFIG.amountNano, payload,
      expiresAt: deploymentPaymentExpiresAt,
      paymentStatus: ledger.rows[0]?.deployment_payment_status ?? "created",
      paymentSent: false,
      message: "Send only the exact displayed amount from the connected wallet. Payment is not confirmed until on-chain verification succeeds.",
    });
  } catch (error) {
    console.error("[MAGROXIN] Deployment payment request failed:", error instanceof Error ? error.message : "Unknown error");
    return res.status(503).json({ ok: false, error: "Unable to create deployment payment request.", paymentSent: false });
  }
});

app.post("/api/orders/:id/verify-deployment-payment", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!validOrderId(id)) return res.status(400).json({ ok: false, error: "Invalid order ID.", paymentMarkedPaid: false });
  if (!DEPLOYMENT_PAYMENT_CONFIG.enabled || !TONCENTER_API_KEY) {
    return res.status(503).json({ ok: false, error: "Deployment payment verification is disabled.", paymentMarkedPaid: false });
  }

  let order: Order | null;
  try { order = await getOrder(id); }
  catch { return res.status(503).json({ ok: false, error: "Unable to retrieve order.", paymentMarkedPaid: false }); }
  if (!order) return res.status(404).json({ ok: false, error: "Order not found.", paymentMarkedPaid: false });
  if (order.status !== "paid" || !order.paymentTxHash) {
    return res.status(409).json({ ok: false, error: "The 100 TON service fee must be verified first.", paymentMarkedPaid: false });
  }

  let submittedWalletAddress: string;
  try {
    if (typeof req.body?.walletAddress !== "string") throw new Error("Missing wallet address.");
    submittedWalletAddress = normalizeAddress(req.body.walletAddress);
  } catch {
    return res.status(400).json({ ok: false, error: "A valid connected wallet address is required.", paymentMarkedPaid: false });
  }
  if (submittedWalletAddress !== normalizeAddress(order.walletAddress)) {
    return res.status(403).json({ ok: false, error: "Connected wallet does not match this order.", paymentMarkedPaid: false });
  }

  try {
    const existing = await pool.query("SELECT deployment_payment_status, deployment_payment_tx_hash FROM magroxin_orders WHERE id = $1", [id]);
    if (existing.rows[0]?.deployment_payment_status === "paid") {
      return res.json({ ok: true, status: "paid", paymentMarkedPaid: true, paymentTxHash: existing.rows[0].deployment_payment_tx_hash, deploymentEnabled: false, message: "Deployment payment verified; token deployment is still disabled." });
    }

    const now = Date.now();
    const claim = await pool.query(
      `UPDATE magroxin_orders SET deployment_payment_last_verification_at = $2
       WHERE id = $1 AND status = 'paid' AND deployment_payment_status = 'created'
       AND (deployment_payment_last_verification_at IS NULL OR deployment_payment_last_verification_at <= $3)
       RETURNING id`,
      [id, now, now - 30000],
    );
    if (claim.rowCount !== 1) {
      return res.status(429).json({ ok: false, error: "Deployment payment was checked recently or is no longer awaiting payment.", paymentMarkedPaid: false });
    }

    const payment = await findVerifiedDeploymentPayment(order);
    if (!payment) return res.status(202).json({ ok: true, status: "pending", paymentMarkedPaid: false, message: "No matching successful deployment payment found yet." });
    if (payment.hash === order.paymentTxHash) {
      return res.status(409).json({ ok: false, error: "Deployment payment must be a separate transaction from the service fee.", paymentMarkedPaid: false });
    }

    const update = await pool.query(
      `UPDATE magroxin_orders
       SET deployment_payment_status = 'paid', deployment_payment_tx_hash = $1,
           deployment_payment_amount_nano = $2
       WHERE id = $3 AND status = 'paid' AND deployment_payment_status = 'created'
         AND deployment_payment_tx_hash IS NULL AND payment_tx_hash <> $1
       RETURNING id`,
      [payment.hash, DEPLOYMENT_PAYMENT_CONFIG.amountNano, id],
    );
    if (update.rowCount !== 1) return res.status(409).json({ ok: false, error: "Payment state changed or transaction was already used.", paymentMarkedPaid: false });

    return res.json({ ok: true, status: "paid", paymentMarkedPaid: true, paymentTxHash: payment.hash, deploymentEnabled: false, message: "Deployment cost verified. Token deployment is not enabled yet." });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return res.status(409).json({ ok: false, error: "This transaction has already been used.", paymentMarkedPaid: false });
    console.error("[MAGROXIN] Deployment payment verification failed:", error instanceof Error ? error.message : "Unknown error");
    return res.status(503).json({ ok: false, error: "Unable to verify deployment payment right now.", paymentMarkedPaid: false });
  }
});

app.get("/api/orders/:id", async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;

    if (!validOrderId(orderId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID.",
      });
    }

    let order = await getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found.",
      });
    }

    order = await expireOrderIfNeeded(order);

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
    console.log("[MAGROXIN] Network: Mainnet only");
    console.log(
      `[MAGROXIN] Payment requests: ${
        PAYMENT_REQUEST_ENABLED ? "enabled" : "disabled"
      }`,
    );
    console.log(
      `[MAGROXIN] Payment verification: ${
        PAYMENT_VERIFICATION_ENABLED ? "enabled" : "disabled"
      }`,
    );
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
