import { Address } from "@ton/core";

export interface DeploymentPaymentConfig {
  enabled: boolean;
  recipient: string;
  amountNano: string;
}

/**
 * Deployment-cost payments stay unavailable unless an operator explicitly
 * enables them and supplies a parseable TON address and positive nanoTON amount.
 * This validates configuration only; callers must still verify the on-chain
 * transaction before recording payment as paid.
 */
export function readDeploymentPaymentConfig(
  env: Record<string, string | undefined>,
): DeploymentPaymentConfig {
  const enabled = env.ENABLE_DEPLOYMENT_PAYMENT === "true";
  const configuredRecipient = env.DEPLOYMENT_PAYMENT_WALLET?.trim() ?? "";
  const amountNano = env.DEPLOYMENT_PAYMENT_AMOUNT_NANO ?? "";

  if (!enabled || !configuredRecipient || !/^[1-9]\d*$/.test(amountNano)) {
    return { enabled: false, recipient: "", amountNano: "" };
  }

  try {
    // Normalize accepted user-friendly/raw forms to one canonical raw address.
    const recipient = Address.parse(configuredRecipient).toRawString().toLowerCase();
    return { enabled: true, recipient, amountNano };
  } catch {
    return { enabled: false, recipient: "", amountNano: "" };
  }
}
