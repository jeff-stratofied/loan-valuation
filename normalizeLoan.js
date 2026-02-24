// ==========================================
// normalizeLoan.js  — FINAL VERSION (Feb 24 2026)
// ==========================================

function derivePurchaseDateFromOwnership(ownershipLots = []) {
  if (!Array.isArray(ownershipLots) || ownershipLots.length === 0) return "";
  const dates = ownershipLots
    .map(lot => lot?.purchaseDate)
    .filter(d => typeof d === "string" && d.trim() !== "")
    .sort();
  return dates[0] || "";
}

export function normalizeLoan(l) {
  // Loan ID is the single source of truth
  // Accept PROM_NOTE_ID from import as loanId (per your request)
  let loanId = String(
    l.loanId ??
    l.promNoteId ??
    l.PROM_NOTE_ID ??
    l.id ??
    "unknown"
  );

  // Preserve ownership lots first
  const ownershipLots = Array.isArray(l.ownershipLots)
    ? l.ownershipLots.map(lot => ({ ...lot }))
    : [];

  // Derive authoritative purchaseDate
  const derivedPurchaseDate =
    l.purchaseDate ||
    derivePurchaseDateFromOwnership(ownershipLots) ||
    l.loanStartDate ||
    l.dateOnSystem ||
    "";

  const normalized = {
    // Identity & descriptive
    loanName: l.loanName || "",
    school: l.school || l.originalSchoolName || "",
    originalSchoolName: l.originalSchoolName || l.school || "",

    // Dates
    loanStartDate: l.loanStartDate || "",
    dateOnSystem: l.dateOnSystem || l.loanStartDate || "",
    purchaseDate: derivedPurchaseDate,
    estMaturityDate: l.estMaturityDate || "",

    // Economics
    principal: Number(l.principal ?? l.origPrincipalBal ?? l.purchasePrice ?? 0),
    origPrincipalBal: Number(l.origPrincipalBal ?? l.principal ?? 0),
    purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),
    nominalRate: Number(l.nominalRate ?? l.rate ?? l["LOAN INT RATE"] ?? 0),

    // Term & status (using your existing terms)
    termYears: Number(l.termYears ?? 0),
    graceYears: Number(l.graceYears ?? 0),
    loanStatus: l.loanStatus || "S",                    // C/D/F/G/P/R/S

    // School / Grace
    yearInSchool: l.yearInSchool != null ? String(l.yearInSchool) : null,
    mosGraceElig: Number(l.mosGraceElig ?? Math.round((l.graceYears || 0) * 12)),

    // Borrower risk fields (exact names you already use)
    appScore: l.appScore != null ? Number(l.appScore) : null,
    ficoCosigner: l.ficoCosigner != null ? Number(l.ficoCosigner) : null,

    // Fees & events
    feeWaiver: l.feeWaiver || "none",
    events: Array.isArray(l.events) ? l.events : [],

    // Ownership
    ownershipLots,

    // IDs — single canonical field
    loanId,
    borrowerId: l.borrowerId || `BRW-${loanId}`,
    id: loanId,

    // Meta
    user: String(l.user ?? "jeff").trim().toLowerCase(),
    visible: l.visible !== false
  };

  return normalized;
}
