import { createHash } from "node:crypto";
import { Address, beginCell, Cell, Dictionary, contractAddress, storeStateInit, type StateInit } from "@ton/core";
import { Buffer } from "node:buffer";

export type JettonDeploymentInput = {
  adminAddress: string; name: string; symbol: string; description: string; supply: string; decimals: number; imageUrl?: string;
};
export type JettonDeploymentResult = {
  address: string; stateInit: string; payload: string; deployValueNano: string; supplyUnits: string;
};

const CODE_REVISION = "cf176793e04d17580599c7e083fcd7af8f050035";
const MINTER_CODE_URL = `https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/${CODE_REVISION}/contracts/build/jetton-minter.boc`;
const WALLET_CODE_URL = `https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/${CODE_REVISION}/contracts/build/jetton-wallet.boc`;
const MAX_SUPPLY_UNITS = 10n ** 30n;
const MINT_TO_WALLET_NANO = 300000000n;

async function loadCode(url: string): Promise<Cell> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Contract code download failed: HTTP ${response.status}`);
  const cells = Cell.fromBoc(Buffer.from(await response.arrayBuffer()));
  if (cells.length !== 1) throw new Error("Unexpected Jetton contract BOC.");
  return cells[0];
}
// TEP-64 snake values must start with the 0x00 snake prefix.
// The first cell has 8 prefix bits, so it can hold at most 126 data bytes;
// continuation cells can hold 127 bytes each.
export function snakeString(value: string): Cell {
  const bytes = Buffer.from(value, "utf8");
  let next: Cell | undefined;

  for (let end = bytes.length; end > 126;) {
    const start = Math.max(126, end - 127);
    const builder = beginCell().storeBuffer(bytes.subarray(start, end));
    if (next) builder.storeRef(next);
    next = builder.endCell();
    end = start;
  }

  const root = beginCell().storeUint(0x00, 8);
  const firstChunk = bytes.subarray(0, 126);
  if (firstChunk.length > 0) root.storeBuffer(firstChunk);
  if (next) root.storeRef(next);
  return root.endCell();
}
export function calculateDeploymentValue(estimatedExecutionFees: bigint): bigint {
  if (estimatedExecutionFees <= 0n) {
    throw new Error("TON Center returned a zero deployment fee estimate.");
  }
  // The minter forwards this TON amount to the recipient Jetton wallet when
  // minting. The wallet funding is message value, not a network fee, so it
  // must be added on top of the TON Center execution-fee estimate.
  return MINT_TO_WALLET_NANO
    + estimatedExecutionFees
    + (estimatedExecutionFees * 30n / 100n)
    + 50000000n;
}

export function buildInitialMintPayload(owner: Address, supplyUnits: bigint): Cell {
  const internalTransfer = beginCell()
    .storeUint(0x178d4519, 32)
    .storeUint(0, 64)
    .storeCoins(supplyUnits)
    .storeAddress(null)
    .storeAddress(owner)
    .storeCoins(1000000n)
    .storeBit(0)
    .endCell();

  return beginCell()
    .storeUint(21, 32)
    .storeUint(0, 64)
    .storeAddress(owner)
    .storeCoins(MINT_TO_WALLET_NANO)
    .storeRef(internalTransfer)
    .endCell();
}

function metadataKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}
function validate(input: JettonDeploymentInput) {
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  const description = input.description.trim();
  if (name.length < 2 || name.length > 100) throw new Error("Token name must contain 2–100 characters.");
  if (!/^[A-Za-z0-9._-]{2,10}$/.test(symbol)) throw new Error("Token symbol must contain 2–10 valid characters.");
  if (description.length > 1000) throw new Error("Description must be at most 1000 characters.");
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) throw new Error("Decimals must be between 0 and 9.");
  if (!/^[1-9]\d*$/.test(input.supply)) throw new Error("Supply must be a positive whole number.");
  const admin = Address.parse(input.adminAddress);
  const supplyUnits = BigInt(input.supply) * 10n ** BigInt(input.decimals);
  if (supplyUnits > MAX_SUPPLY_UNITS) throw new Error("Token supply exceeds the supported limit.");
  return { admin, supplyUnits, name, symbol, description };
}
export async function prepareJettonDeployment(input: JettonDeploymentInput, toncenterApiKey: string): Promise<JettonDeploymentResult> {
  const v = validate(input);
  const [minterCode, walletCode] = await Promise.all([loadCode(MINTER_CODE_URL), loadCode(WALLET_CODE_URL)]);
  const dictionary = Dictionary.empty(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
  const metadataEntries: Array<[string, string]> = [["name", v.name], ["symbol", v.symbol.toUpperCase()], ["description", v.description], ["decimals", String(input.decimals)]];
  if (input.imageUrl) metadataEntries.push(["image", input.imageUrl]);
  for (const [key, value] of metadataEntries) {
    dictionary.set(metadataKey(key), snakeString(value));
  }
  const content = beginCell().storeUint(0, 8).storeDict(dictionary).endCell();
  const data = beginCell().storeCoins(0).storeAddress(v.admin).storeRef(content).storeRef(walletCode).endCell();
  const stateInit: StateInit = { code: minterCode, data };
  const address = contractAddress(0, stateInit);
  // Match TON's reference mintBody layout for this classic Jetton minter.
  const payload = buildInitialMintPayload(v.admin, v.supplyUnits);
  if (!toncenterApiKey) throw new Error("TON Center API key is required for deployment fee estimation.");
  const estimateResponse = await fetch("https://toncenter.com/api/v2/estimateFee", {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": toncenterApiKey },
    body: JSON.stringify({ address: address.toString({ bounceable: true, testOnly: false }), body: payload.toBoc().toString("base64"), init_code: minterCode.toBoc().toString("base64"), init_data: data.toBoc().toString("base64"), ignore_chksig: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!estimateResponse.ok) throw new Error("TON Center deployment fee estimation failed.");
  const estimateJson = await estimateResponse.json() as any;
  if (estimateJson.ok !== true || !estimateJson.result) throw new Error("TON Center returned an invalid deployment fee estimate.");
  // TON Center v2 normally includes total_fees, but some responses expose
  // only the component fields. Sum the explicit components when total_fees is
  // absent instead of silently treating a valid estimate as zero.
  const feeTotal = (fees: any): bigint => {
    if (!fees || typeof fees !== "object") return 0n;
    if (fees.total_fees !== undefined && fees.total_fees !== null) {
      return BigInt(fees.total_fees);
    }
    return ["in_fwd_fee", "storage_fee", "gas_fee", "fwd_fee"].reduce(
      (sum, key) => sum + BigInt(fees[key] ?? 0), 0n
    );
  };
  const sourceFees = feeTotal(estimateJson.result.source_fees);
  const destinationFees = (estimateJson.result.destination_fees ?? []).reduce(
    (sum: bigint, item: any) => sum + feeTotal(item), 0n
  );
  // Destination fees can be empty for a first-time deployment. Use every
  // fee component TON Center actually returned, but never invent a fee value.
  const estimatedExecutionFees = sourceFees + destinationFees;
  // Include the 0.3 TON mint-to-wallet value as well as estimated execution
  // fees. Omitting this message value can make the mint action fail and leave
  // the deployed Jetton with a zero total supply.
  const estimatedDeployValueNano = calculateDeploymentValue(estimatedExecutionFees);
  return {
    address: address.toString({ bounceable: false, testOnly: false }),
    stateInit: beginCell().store(storeStateInit(stateInit)).endCell().toBoc().toString("base64"),
    payload: payload.toBoc().toString("base64"),
    deployValueNano: estimatedDeployValueNano.toString(),
    supplyUnits: v.supplyUnits.toString(),
  };
}
