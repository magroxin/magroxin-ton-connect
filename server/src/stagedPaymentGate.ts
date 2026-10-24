export type PaymentStatus = "created" | "paid" | "expired" | "failed";

export interface StagedPaymentGate {
  serviceFeeStatus: PaymentStatus;
  serviceFeeTxHash: string | null;
  deploymentPaymentStatus: PaymentStatus;
  deploymentPaymentTxHash: string | null;
}

/**
 * Fail-closed deployment gate. A deployment may only be prepared after both
 * independent payments are verified and their transaction identifiers differ.
 * This helper is a safety primitive; it does not itself verify transactions.
 */
export function canPrepareDeployment(state: StagedPaymentGate): boolean {
  if (state.serviceFeeStatus !== "paid") return false;
  if (state.deploymentPaymentStatus !== "paid") return false;

  const serviceHash = state.serviceFeeTxHash?.trim();
  const deploymentHash = state.deploymentPaymentTxHash?.trim();

  if (!serviceHash || !deploymentHash) return false;
  if (serviceHash === deploymentHash) return false;

  return true;
}
