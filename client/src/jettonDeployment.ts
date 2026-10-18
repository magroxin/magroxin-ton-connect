
import {
  Address,
  beginCell,
  Cell,
  Dictionary,
  contractAddress,
  storeStateInit,
  type StateInit,
} from "@ton/core";
import { Buffer } from "buffer";

export type JettonDeploymentInput = {
  adminAddress: string;
  name: string;
  symbol: string;
  description: string;
  supply: string;
  decimals: number;
};

export type JettonDeploymentResult = {
  address: string;
  stateInit: string;
  payload: string;
  deployValueNano: string;
  supplyUnits: string;
};

const MINTER_CODE_URL =
  "https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/main/contracts/build/jetton-minter.boc";

const WALLET_CODE_URL =
  "https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/main/contracts/build/jetton-wallet.boc";

// Provisional transaction budget only; actual network costs may vary.
// Do not send a Mainnet transaction until contract BOCs are verified.
const DEPLOY_VALUE_NANO = "500000000";
const WALLET_FUNDING_NANO = "100000000";
const MAX_SUPPLY_UNITS = 10n ** 30n;

async function loadContractCode(url: string): Promise<Cell> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `Could not load contract code: HTTP ${response.status}`,
    );
  }

  const cells = Cell.fromBoc(
    Buffer.from(await response.arrayBuffer()),
  );

  if (cells.length !== 1) {
    throw new Error("Unexpected contract BOC format.");
  }

  return cells[0];
}

function validateInput(input: JettonDeploymentInput): {
  admin: Address;
  supplyUnits: bigint;
} {
  const name = input.name.trim();
  const symbol = input.symbol.trim();

  if (name.length < 2 || name.length > 100) {
    throw new Error("Token name must contain 2–100 characters.");
  }

  if (!/^[A-Za-z0-9._-]{2,10}$/.test(symbol)) {
    throw new Error("Token symbol must contain 2–10 valid characters.");
  }

  if (input.description.trim().length > 1000) {
    throw new Error("Description must be at most 1000 characters.");
  }

  if (
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > 9
  ) {
    throw new Error("Decimals must be between 0 and 9.");
  }

  if (!/^[1-9]\d*$/.test(input.supply)) {
    throw new Error("Supply must be a positive whole number.");
  }

  const supplyUnits =
    BigInt(input.supply) * 10n ** BigInt(input.decimals);

  if (supplyUnits > MAX_SUPPLY_UNITS) {
    throw new Error("Token supply exceeds the supported limit.");
  }

  return {
    admin: Address.parse(input.adminAddress),
    supplyUnits,
  };
}

async function metadataKey(key: string): Promise<Buffer> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );

  return Buffer.from(digest);
}

function snakeString(value: string): Cell {
  const bytes = Buffer.from(value, "utf8");

  if (bytes.length === 0) {
    return beginCell().endCell();
  }

  let next: Cell | undefined;

  for (let offset = bytes.length; offset > 0; offset -= 127) {
    const start = Math.max(0, offset - 127);
    const chunk = bytes.subarray(start, offset);
    const builder = beginCell().storeBuffer(chunk);

    if (next) {
      builder.storeRef(next);
    }

    next = builder.endCell();
  }

  return next!;
}

async function buildMetadata(
  input: JettonDeploymentInput,
): Promise<Cell> {
  const dictionary = Dictionary.empty(
    Dictionary.Keys.Buffer(32),
    Dictionary.Values.Cell(),
  );

  const fields: Array<[string, string]> = [
    ["name", input.name.trim()],
    ["symbol", input.symbol.trim().toUpperCase()],
    ["description", input.description.trim()],
    ["decimals", String(input.decimals)],
  ];

  for (const [key, value] of fields) {
    dictionary.set(
      await metadataKey(key),
      snakeString(value),
    );
  }

  // TEP-64 on-chain metadata content.
  return beginCell()
    .storeUint(0, 8)
    .storeDict(dictionary)
    .endCell();
}

export async function prepareJettonDeployment(
  input: JettonDeploymentInput,
): Promise<JettonDeploymentResult> {
  const { admin, supplyUnits } = validateInput(input);

  const [minterCode, walletCode, content] = await Promise.all([
    loadContractCode(MINTER_CODE_URL),
    loadContractCode(WALLET_CODE_URL),
    buildMetadata(input),
  ]);

  // The provided minter storage starts with total_supply = 0.
  // The mint message below requests minting to the admin's wallet.
  const data = beginCell()
    .storeCoins(0)
    .storeAddress(admin)
    .storeRef(content)
    .storeRef(walletCode)
    .endCell();

  const stateInit: StateInit = {
    code: minterCode,
    data,
  };

  const address = contractAddress(0, stateInit);

  // Jetton internal-transfer body sent by the minter to the
  // recipient's Jetton wallet.
  const internalTransfer = beginCell()
    .storeUint(0x178d4519, 32)
    .storeUint(0, 64)
    .storeCoins(supplyUnits)
    .storeAddress(address)
    .storeAddress(admin)
    .storeCoins(0)
    .storeBit(0)
    .endCell();

  // Standard minter mint opcode.
  const mintPayload = beginCell()
    .storeUint(21, 32)
    .storeUint(0, 64)
    .storeAddress(admin)
    .storeCoins(BigInt(WALLET_FUNDING_NANO))
    .storeRef(internalTransfer)
    .endCell();

  const stateInitBoc = beginCell()
    .store(storeStateInit(stateInit))
    .endCell()
    .toBoc()
    .toString("base64");

  return {
    address: address.toString({
      bounceable: false,
      testOnly: false,
    }),
    stateInit: stateInitBoc,
    payload: mintPayload.toBoc().toString("base64"),
    deployValueNano: DEPLOY_VALUE_NANO,
    supplyUnits: supplyUnits.toString(),
  };
}
