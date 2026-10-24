export interface DeploymentPaymentConfig {
  enabled: boolean;
  recipient: string;
  amountNano: string;
}

/**
 * Deployment-cost payments stay unavailable unless an operator explicitly
 * enables them and supplies a valid destination and positive nanoTON amount.
 * This validates configuration only; callers must still verify the on-chain
 * transaction before recording payment as paid.
 */
export function readDeploymentPaymentConfig(
  env: Record<string, string | undefined>,
): DeploymentPaymentConfig {
  const enabled = env.ENABLE_DEPLOYMENT_PAYMENT === "true";
  const recipient = env.DEPLOYMENT_PAYMENT_WALLET?.trim() ?? "";
  const amountNano = env.DEPLOYMENT_PAYMENT_AMOUNT_NANO?.trim() ?? "";

  if (!enabled) {
    return { enabled: false, recipient: "", amountNano: "" };
  }

  if (!recipient || !amountNano || !/^[1-9]\d*$/.test(amountNano)) {
    return { enabled: false, recipient: "", amountNano: "" };
  }

  return { enabled: true, recipient, amountNano };
}
