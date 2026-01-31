// feePolicy.js (renamed internals for consistency)

export function isFeeWaived(user, loan, type) {
  // Loan-level override wins
  if (loan?.feeWaiver === "all") return true;

  if (loan?.feeWaiver === "setup") {
    return type === "setup";
  }

  if (loan?.feeWaiver === "grace") {
    return type === "setup" || type === "servicing";
  }

  // User-level default
  const p = user?.feeWaiver || "none";

  if (p === "all") return true;
  if (p === "setup" && type === "setup") return true;
  if (p === "grace" && (type === "setup" || type === "servicing")) return true;

  return false;
}
