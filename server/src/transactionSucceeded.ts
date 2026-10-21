export function transactionSucceeded(tx: any): boolean {
  const description = tx?.description;

  if (!description || typeof description !== "object") {
    return false;
  }

  // Reject failed or aborted transactions.
  if (description.aborted !== false) return false;

  // Require the API to explicitly confirm the transaction was not destroyed.
  if (description.destroyed !== false) return false;

  const compute = description.compute_ph;

  if (!compute || compute.success !== true) {
    return false;
  }

  if (compute.skipped === true) {
    return false;
  }

  // If an action phase exists, it must have succeeded.
  const action = description.action;

  if (action != null) {
    if (action.success !== true) return false;
    if (action.valid !== true) return false;
    if (action.no_funds === true) return false;
  }

  return true;
}
