// normalizeLoan.js

function derivePurchaseDateFromOwnership(ownershipLots = []) {
  if (!Array.isArray(ownershipLots) || ownershipLots.length === 0) return "";
  const dates = ownershipLots
    .map(lot => lot?.purchaseDate)
    .filter(d => typeof d === "string" && d.trim() !== "")
    .sort();
  return dates[0] || "";
}

export function normalizeLoan(l) {
  let loanId = String(
    l.loanId ??
    l.promNoteId ??
    l.PROM_NOTE_ID ??
    l.id ??
    "unknown"
  );

  const ownershipLots = Array.isArray(l.ownershipLots)
    ? l.ownershipLots.map(lot => ({ ...lot }))
    : l.ownershipLots?.length === 0
      ? [{ user: "market", pct: 1, purchaseDate: l.loanStartDate || l.dateOnSystem || "" }]
      : [];

  const derivedPurchaseDate =
    l.purchaseDate ||
    derivePurchaseDateFromOwnership(ownershipLots) ||
    l.loanStartDate ||
    l.dateOnSystem ||
    "";

  const graceYears = Number(l.graceYears ?? (l.mosGraceElig ? l.mosGraceElig / 12 : 0));

  const normalized = {
    loanName: l.loanName || "",
    school: l.school || l.originalSchoolName || "",
    originalSchoolName: l.originalSchoolName || l.school || "",  // keep for import fallback

    loanStartDate: l.loanStartDate || l.dateOnSystem || "",
    dateOnSystem: l.dateOnSystem || l.loanStartDate || "",
    purchaseDate: derivedPurchaseDate,

    principal: Number(l.principal ?? l.origPrincipalBal ?? 0),
    origPrincipalBal: Number(l.origPrincipalBal ?? l.principal ?? 0),
    nominalRate: Number(l.nominalRate ?? l.rate ?? 0),

    termYears: Number(l.termYears ?? (l.termMonths ? Math.ceil(l.termMonths / 12) : 0)),
    graceYears,

    loanStatus: l.loanStatus || "",

    feeWaiver: l.feeWaiver || "none",
    events: Array.isArray(l.events) ? l.events : [],

    ownershipLots,

    loanId,
    borrowerId: l.borrowerId || `BRW-${loanId}`,
    id: loanId,

    user: String(l.user ?? "market").trim().toLowerCase(),
    visible: l.visible !== false
  };

  return normalized;
}
