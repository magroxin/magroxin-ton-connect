export function transactionSucceeded(tx: any): boolean {
  const description = tx?.description;

  if (!description || typeof description !== "object") {
    return false;
  }

  // Fail closed: require explicit successful transaction status fields.
  if (description.aborted !== false) return false;
  if (description.destroyed !== false) return false;

  const compute = description.compute_ph;
  if (!compute || compute.success !== true || compute.skipped !== false) {
    return false;
  }

  // An action phase may be absent for a simple transfer, but if present
  // every field used to establish success must explicitly indicate success.
  const action = description.action;
  if (action != null) {
    if (typeof action !== "object") return false;
    if (action.success !== true) return false;
    if (action.valid !== true) return false;
    if (action.no_funds !== false) return false;
  }

  return true;
}
