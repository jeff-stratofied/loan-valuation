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

  // Preserve ownership lots FIRST
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

  // Build normalized loan object
  const normalized = {
    // Identity & descriptive fields
    loanName: l.loanName || "",
    school: l.school || l.originalSchoolName || "",
    originalSchoolName: l.originalSchoolName || l.school || "",

    // Dates (ordered intentionally)
    loanStartDate: l.loanStartDate || "",
    dateOnSystem: l.dateOnSystem || l.loanStartDate || "",
    purchaseDate: derivedPurchaseDate,
    estMaturityDate: l.estMaturityDate || "",

    // Economics
    principal: Number(l.principal ?? l.origPrincipalBal ?? l.purchasePrice ?? 0),
    origPrincipalBal: Number(l.origPrincipalBal ?? l.principal ?? 0),
    purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),
    nominalRate: Number(l.nominalRate ?? l.rate ?? 0),

    // Term & status
    termYears: Number(l.termYears ?? 0),
    graceYears: Number(l.graceYears ?? 0),
    loanStatus: l.loanStatus || "S",                    // C/D/F/G/P/R/S

    // Grace & school info
    mosGraceElig: Number(l.mosGraceElig ?? Math.round((l.graceYears || 0) * 12)),
    yearInSchool: l.yearInSchool != null ? Number(l.yearInSchool) : null,  // 1-5,A,B,C,D,Z

    // Fees & events
    feeWaiver: l.feeWaiver || "none",
    events: Array.isArray(l.events) ? l.events : [],

    // Borrower risk fields
    appScore: l.appScore != null ? Number(l.appScore) : null,
    ficoCosigner: l.ficoCosigner != null ? Number(l.ficoCosigner) : null,

    // IDs
    ownershipLots,
    loanId,
    borrowerId: l.borrowerId || `BRW-${loanId}`,
    id: loanId,
    promNoteId: l.promNoteId || loanId,

    // Meta
    user: String(l.user ?? "jeff").trim().toLowerCase(),
    visible: l.visible !== false
  };

  return normalized;
}
