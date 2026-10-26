import { transactionSucceeded } from "./transactionSucceeded.js";

export interface ExpectedPayment {
  sender: string;
  recipient: string;
  expectedAmount: bigint;
  start: number;
  end: number;
  expectedComment: string | null;
}

export interface PaymentMatcherDependencies {
  normalizeAddress(value: string): string;
  decodeComment(body: unknown): string | null;
}

/**
 * TON Center v3 transaction hashes are 32-byte base64 values. Normalize
 * base64url and unpadded variants to canonical padded base64 so the database's
 * unique transaction-hash constraint cannot be bypassed by representation.
 */
export function normalizeTransactionHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(input)) return null;

  const standard = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const decoded = Buffer.from(standard, "base64");
  if (decoded.length !== 32) return null;

  const canonical = decoded.toString("base64");
  if (canonical.replace(/=+$/, "") !== standard) return null;
  return canonical;
}

export function matchIncomingPaymentTransaction(
  value: unknown,
  expected: ExpectedPayment,
  dependencies: PaymentMatcherDependencies,
): { hash: string } | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, any>;
  const transactionHash = normalizeTransactionHash(tx.hash);

  if (
    transactionHash === null ||
    typeof tx.now !== "number" ||
    !Number.isSafeInteger(tx.now) ||
    !transactionSucceeded(tx)
  ) {
    return null;
  }

  const msg = tx.in_msg;
  if (
    !msg ||
    msg.bounced !== false ||
    typeof msg.source !== "string" ||
    typeof msg.destination !== "string" ||
    typeof msg.value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(msg.value)
  ) {
    return null;
  }

  let actualSender: string;
  let actualRecipient: string;

  try {
    actualSender = dependencies.normalizeAddress(msg.source);
    actualRecipient = dependencies.normalizeAddress(msg.destination);
  } catch {
    return null;
  }

  if (actualSender !== expected.sender) return null;
  if (actualRecipient !== expected.recipient) return null;

  // Accept only the provider's decimal nanoTON representation. BigInt alone
  // also accepts hexadecimal, signed, and whitespace-padded strings.
  const actualAmount = BigInt(msg.value);
  if (actualAmount !== expected.expectedAmount) return null;

  const txTime = tx.now;
  if (txTime < expected.start || txTime > expected.end) return null;

  const decoded = msg.message_content?.decoded;
  const comment =
    typeof decoded?.comment === "string"
      ? decoded.comment
      : typeof decoded?.text === "string"
        ? decoded.text
        : dependencies.decodeComment(msg.message_content?.body);

  if (expected.expectedComment === null) {
    // No-comment mode must reject any transaction carrying a comment.
    if (comment !== null && comment !== "") return null;
  } else if (comment !== expected.expectedComment) {
    return null;
  }

  return { hash: transactionHash };
}

export interface ParsedTransactionPage {
  transactions: unknown[];
  hasMore: boolean;
}

/**
 * Validate TON Center v3 pagination responses. A short page proves the
 * requested time range has been exhausted; a full page may have more results.
 * Malformed responses throw so callers fail closed rather than mark unpaid.
 */
export function parseTransactionPage(
  value: unknown,
  pageSize: number,
): ParsedTransactionPage {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Invalid transaction page size.");
  }

  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { transactions?: unknown }).transactions)
  ) {
    throw new Error("Invalid TON Center transaction response.");
  }

  const transactions = (value as { transactions: unknown[] }).transactions;
  if (transactions.some((transaction) => !transaction || typeof transaction !== "object" || Array.isArray(transaction))) {
    throw new Error("Invalid TON Center transaction response.");
  }
  return { transactions, hasMore: transactions.length >= pageSize };
}
