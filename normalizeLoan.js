// ==========================================
// normalizeLoan.js
// ==========================================

function derivePurchaseDateFromOwnership(ownershipLots = []) {
  if (!Array.isArray(ownershipLots) || ownershipLots.length === 0) {
    return "";
  }

  const dates = ownershipLots
    .map(lot => lot?.purchaseDate)
    .filter(d => typeof d === "string" && d.trim() !== "")
    .sort(); // ISO YYYY-MM-DD sorts correctly

  return dates[0] || "";
}

export function normalizeLoan(l) {
  const loanId = String(l.loanId ?? l.id ?? "unknown");

  console.log(
    `normalizeLoan called for loan ${loanId} — incoming purchaseDate: ${l.purchaseDate || "(missing)"}`
  );

  // -----------------------------
  // Preserve ownership lots FIRST
  // -----------------------------
  const ownershipLots = Array.isArray(l.ownershipLots)
    ? l.ownershipLots.map(lot => ({ ...lot }))
    : [];

  // -----------------------------
  // Derive authoritative purchaseDate
  // -----------------------------
  const derivedPurchaseDate =
    l.purchaseDate ||
    derivePurchaseDateFromOwnership(ownershipLots) ||
    l.loanStartDate ||
    "";

  // -----------------------------
  // Build normalized loan object
  // -----------------------------
const normalized = {
  // --------------------------------
  // Identity & descriptive fields
  // --------------------------------
  loanName: l.loanName || "",
  school: l.school || "",

  // --------------------------------
  // Dates (ordered intentionally)
  // --------------------------------
  loanStartDate: l.loanStartDate || "",
  purchaseDate: derivedPurchaseDate,

  // --------------------------------
  // Economics
  // --------------------------------
  principal: Number(l.principal ?? l.purchasePrice ?? 0),
  purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),
  nominalRate: Number(l.nominalRate ?? l.rate ?? 0),

  // --------------------------------
  // Term
  // --------------------------------
  termYears: Number(l.termYears ?? 0),
  graceYears: Number(l.graceYears ?? 0),

  // --------------------------------
  // Fees & events
  // --------------------------------
  feeWaiver: l.feeWaiver || "none",
  events: Array.isArray(l.events) ? l.events : [],

  // --------------------------------
  // Ownership
  // --------------------------------
  ownershipLots,

  // --------------------------------
  // IDs
  // --------------------------------
  loanId,
  borrowerId: l.borrowerId || `BRW-${loanId}`,
  id: loanId,

  // --------------------------------
  // Meta
  // --------------------------------
  user: String(l.user ?? "jeff").trim().toLowerCase(),
  visible: l.visible !== false
};


  console.log(
    `normalizeLoan output — purchaseDate: ${normalized.purchaseDate || "(missing)"}`
  );

  return normalized;
}
