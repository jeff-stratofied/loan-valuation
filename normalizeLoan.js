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
    ...l,

    // Identity
    id: loanId,
    loanId,

    // Display
    loanName: l.loanName || "",

    // Economics
    nominalRate: Number(l.nominalRate ?? l.rate ?? 0),
    principal: Number(l.principal ?? l.purchasePrice ?? 0),
    purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),

    // Term
    termYears: Number(l.termYears ?? 0),
    graceYears: Number(l.graceYears ?? 0),

    // Dates
    loanStartDate: l.loanStartDate || "",
    purchaseDate: derivedPurchaseDate, // ✅ ALWAYS SET

    // Ownership
    ownershipLots,

    // Meta
    user: String(l.user ?? "jeff").trim().toLowerCase(),
    visible: l.visible !== false
  };

  console.log(
    `normalizeLoan output — purchaseDate: ${normalized.purchaseDate || "(missing)"}`
  );

  return normalized;
}
