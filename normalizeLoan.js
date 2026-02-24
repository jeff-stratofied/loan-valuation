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
    : [];

  const derivedPurchaseDate =
    l.purchaseDate ||
    derivePurchaseDateFromOwnership(ownershipLots) ||
    l.loanStartDate ||
    l.dateOnSystem ||
    "";

  const normalized = {
    loanName: l.loanName || "",
    school: l.school || l.originalSchoolName || "",
    originalSchoolName: l.originalSchoolName || l.school || "",

    loanStartDate: l.loanStartDate || "",
    dateOnSystem: l.dateOnSystem || l.loanStartDate || "",
    purchaseDate: derivedPurchaseDate,
    estMaturityDate: l.estMaturityDate || "",

    principal: Number(l.principal ?? l.origPrincipalBal ?? 0),
    origPrincipalBal: Number(l.origPrincipalBal ?? l.principal ?? 0),
    nominalRate: Number(l.nominalRate ?? l.rate ?? l["LOAN INT RATE"] ?? 0),

    termYears: Number(l.termYears ?? (l.termMonths ? Math.ceil(l.termMonths / 12) : 0)),
    graceYears: Number(l.graceYears ?? (l.mosGraceElig ? l.mosGraceElig / 12 : 0)),

    loanStatus: l.loanStatus || "",                    // imported codes or blank
    yearInSchool: l.yearInSchool != null ? String(l.yearInSchool) : null,
    mosGraceElig: Number(l.mosGraceElig ?? 0),

    appScore: l.appScore != null ? Number(l.appScore) : null,
    ficoCosigner: l.ficoCosigner != null ? Number(l.ficoCosigner) : null,

    feeWaiver: l.feeWaiver || "none",
    events: Array.isArray(l.events) ? l.events : [],

    ownershipLots,

    loanId,
    borrowerId: l.borrowerId || `BRW-${loanId}`,
    id: loanId,

    user: String(l.user ?? "market").trim().toLowerCase(),   // default to market for imports
    visible: l.visible !== false
  };

  return normalized;
}
