// /normalizeLoan.js

export function normalizeLoan(l) {
  return {
    ...l,

    // -------------------------
    // Identity
    // -------------------------
    id: String(l.loanId ?? l.id),
    loanId: String(l.loanId ?? l.id),
    loanName: l.loanName || "",

    // -------------------------
    // Rates & amounts
    // -------------------------
    nominalRate: Number(l.nominalRate ?? l.rate ?? 0),
    principal: Number(l.principal ?? l.purchasePrice ?? 0),
    purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),

    // -------------------------
    // Terms
    // -------------------------
    termYears: Number(l.termYears ?? 0),
    graceYears: Number(l.graceYears ?? 0),

    // -------------------------
    // Dates
    // -------------------------
    loanStartDate: l.loanStartDate,
    purchaseDate: l.purchaseDate,

    // -------------------------
    // User visibility
    // -------------------------
    user: String(l.user ?? "jeff").trim().toLowerCase(),
    visible: l.visible !== false
  };
}
