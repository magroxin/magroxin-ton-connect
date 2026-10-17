
import {
  Address,
  beginCell,
  Cell,
  Dictionary,
  contractAddress,
  type StateInit,
} from "@ton/core";

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
  initialData: string;
};

const MINTER_CODE_URL =
  "https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/main/contracts/build/jetton-minter.boc";

const WALLET_CODE_URL =
  "https://raw.githubusercontent.com/magroxin/magroxin-ton-connect/main/contracts/build/jetton-wallet.boc";

const MAX_SUPPLY = 10n ** 30n;

async function loadContractCode(url: string): Promise<Cell> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Could not load contract code: HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const cells = Cell.fromBoc(bytes);

  if (cells.length !== 1) {
    throw new Error("Unexpected contract BOC format.");
  }

  return cells[0];
}

function validateInput(input: JettonDeploymentInput): Address {
  const name = input.name.trim();
  const symbol = input.symbol.trim();

  if (!name || name.length > 100) {
    throw new Error("Token name must contain 1–100 characters.");
  }

  if (!/^[A-Za-z0-9._-]{1,20}$/.test(symbol)) {
    throw new Error("Symbol must contain 1–20 valid characters.");
  }

  if (input.description.length > 1000) {
    throw new Error("Description must be at most 1000 characters.");
  }

  if (
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > 18
  ) {
    throw new Error("Decimals must be between 0 and 18.");
  }

  if (!/^[1-9]\d*$/.test(input.supply)) {
    throw new Error("Supply must be a positive whole number.");
  }

  const supply = BigInt(input.supply) * 10n ** BigInt(input.decimals);

  if (supply > MAX_SUPPLY) {
    throw new Error("Token supply exceeds the supported limit.");
  }

  return Address.parse(input.adminAddress);
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
  const root = beginCell();
  let current = root;

  // Store a UTF-8 string in TON snake format.
  // Each cell contains at most 127 bytes.
  const chunks: Buffer[] = [];

  for (let i = 0; i < bytes.length; i += 127) {
    chunks.push(bytes.subarray(i, i + 127));
  }

  for (let i = 0; i < chunks.length; i++) {
    current.storeBuffer(chunks[i]);

    if (i < chunks.length - 1) {
      const next = beginCell();
      current.storeRef(next.endCell());
      current = next;
    }
  }

  return root.endCell();
}

async function buildMetadata(input: JettonDeploymentInput): Promise<Cell> {
  const entries: [Buffer, Cell][] = [];

  const fields: [string, string][] = [
    ["name", input.name.trim()],
    ["symbol", input.symbol.trim()],
    ["description", input.description.trim()],
    ["decimals", String(input.decimals)],
  ];

  for (const [key, value] of fields) {
    entries.push([
      await metadataKey(key),
      snakeString(value),
    ]);
  }

  const dictionary = Dictionary.empty(
    Dictionary.Keys.Buffer(32),
    Dictionary.Values.Cell(),
  );

  for (const [key, value] of entries) {
    dictionary.set(key, value);
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
  const admin = validateInput(input);

  const [minterCode, walletCode, content] = await Promise.all([
    loadContractCode(MINTER_CODE_URL),
    loadContractCode(WALLET_CODE_URL),
    buildMetadata(input),
  ]);

  const supply =
    BigInt(input.supply) * 10n ** BigInt(input.decimals);

  // Storage layout must exactly match jetton-minter.fc.
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

  const initCell = beginCell()
    .storeBit(0) // split_depth absent
    .storeBit(0) // special absent
    .storeMaybeRef(stateInit.code)
    .storeMaybeRef(stateInit.data)
    .storeDict(null)
    .endCell();

  const address = contractAddress(0, stateInit);

  // The supplied minter source starts with zero supply and does not
  // mint tokens automatically during deployment.
  // Never report this result as a completed token deployment.
  return {
    address: address.toString({
      bounceable: false,
      testOnly: false,
    }),
    stateInit: initCell.toBoc().toString("base64"),
    initialData: beginCell()
      .storeCoins(supply)
      .endCell()
      .toBoc()
      .toString("base64"),
  };
}
