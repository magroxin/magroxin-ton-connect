import { Address, Cell } from "@ton/core";

export function getRunMethodStack(response: unknown): unknown[] {
  const data = response as any;
  if (!data || data.ok !== true) throw new Error("TON Center runGetMethod did not return ok=true.");
  const stack = data.result?.stack ?? data.stack;
  if (!Array.isArray(stack)) throw new Error("TON Center runGetMethod response is missing result.stack.");
  return stack;
}

export function readRunMethodInteger(response: unknown, index = 0): bigint {
  const entry = getRunMethodStack(response)[index] as any;
  if (!Array.isArray(entry) || entry[0] !== "num" || typeof entry[1] !== "string") {
    throw new Error("TON Center runGetMethod returned an invalid integer stack item.");
  }
  try { return BigInt(entry[1]); }
  catch { throw new Error("TON Center runGetMethod returned an unreadable integer."); }
}

export function readRunMethodAddress(response: unknown, index = 0): Address {
  const entry = getRunMethodStack(response)[index] as any;
  if (!Array.isArray(entry) || !["slice", "tvm.Slice", "cell", "tvm.Cell"].includes(entry[0])) {
    throw new Error("TON Center runGetMethod returned an invalid address stack item.");
  }
  const bytes = typeof entry[1] === "string" ? entry[1] : entry[1]?.bytes;
  if (typeof bytes !== "string" || !bytes) throw new Error("TON Center address stack item has no BOC bytes.");
  try {
    const cell = Cell.fromBase64(bytes);
    const address = cell.beginParse().loadAddress();
    if (!address) throw new Error("Address stack item was addr_none.");
    return address;
  } catch {
    throw new Error("TON Center runGetMethod returned an unreadable address.");
  }
}
