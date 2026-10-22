import { transactionSucceeded } from "./transactionSucceeded.js";

export interface ExpectedPayment {
  sender: string;
  recipient: string;
  expectedAmount: bigint;
  start: number;
  end: number;
  expectedComment: string;
}

export interface PaymentMatcherDependencies {
  normalizeAddress(value: string): string;
  decodeComment(body: unknown): string | null;
}

export function matchIncomingPaymentTransaction(
  value: unknown,
  expected: ExpectedPayment,
  dependencies: PaymentMatcherDependencies,
): { hash: string } | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, any>;

  if (
    typeof tx.hash !== "string" ||
    tx.hash.length === 0 ||
    !Number.isSafeInteger(Number(tx.now)) ||
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
    msg.value == null
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

  let actualAmount: bigint;
  try {
    actualAmount = BigInt(String(msg.value));
  } catch {
    return null;
  }

  if (actualAmount !== expected.expectedAmount) return null;

  const txTime = Number(tx.now);
  if (txTime < expected.start || txTime > expected.end) return null;

  const decoded = msg.message_content?.decoded;
  const comment =
    typeof decoded?.comment === "string"
      ? decoded.comment
      : typeof decoded?.text === "string"
        ? decoded.text
        : dependencies.decodeComment(msg.message_content?.body);

  if (comment !== expected.expectedComment) return null;

  return { hash: tx.hash };
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
  return { transactions, hasMore: transactions.length >= pageSize };
}
