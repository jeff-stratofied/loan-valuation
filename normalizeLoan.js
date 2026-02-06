export function normalizeLoan(l) {
  console.log(`normalizeLoan called for loan ${l.loanId || 'unknown'} - incoming purchaseDate: ${l.purchaseDate || '(missing)'}`);

  const normalized = {
    ...l,
    id: String(l.loanId ?? l.id),
    loanId: String(l.loanId ?? l.id),
    loanName: l.loanName || "",
    nominalRate: Number(l.nominalRate ?? l.rate ?? 0),
    principal: Number(l.principal ?? l.purchasePrice ?? 0),
    purchasePrice: Number(l.purchasePrice ?? l.principal ?? 0),
    termYears: Number(l.termYears ?? 0),
    graceYears: Number(l.graceYears ?? 0),
    loanStartDate: l.loanStartDate,
    user: String(l.user ?? "jeff").trim().toLowerCase(),
    visible: l.visible !== false
  };

  console.log(`normalizeLoan output - purchaseDate: ${normalized.purchaseDate || '(missing)'}`);

  return normalized;
}
