// =====================================================
// OWNERSHIP ENGINE — SINGLE SOURCE OF TRUTH
// =====================================================

export const OWNERSHIP_STEP = 5;
export const MARKET_USER = "Market";

// -------------------------------------
// Normalize ownership to always hit 100%
// -------------------------------------

/**
 * OWNERSHIP CONTRACT (AUTHORITATIVE)
 *
 * - loan.ownershipLots is the ONLY source of ownership truth
 * - Each lot represents a single priced tranche
 * - ROI, invested capital, and ownership % derive ONLY from ownershipLots
 *
 * UI must never compute ownership or invested values.
 */

/**
 * Normalizes and ensures consistent ownership structure for a loan.
 * Mutates loan in place for simplicity (common pattern in your codebase).
 * 
 * - Ensures loan.ownership exists with MARKET_USER filling to 100%
 * - Creates/normalizes ownershipLots if missing
 * - Derives top-level purchaseDate from earliest lot if not already set
 * 
 * @param {Object} loan - The loan object to normalize
 */
export function normalizeOwnership(loan) {
  // 1. Ensure ownership allocation model exists
  if (!loan.ownership || !Array.isArray(loan.ownership.allocations)) {
    loan.ownership = {
      unit: "percent",
      step: OWNERSHIP_STEP,
      allocations: [{ user: MARKET_USER, percent: 100 }]
    };
  } else {
    // Calculate assigned % (excluding Market)
    const assigned = loan.ownership.allocations
      .filter(a => a.user !== MARKET_USER)
      .reduce((sum, a) => sum + (Number(a.percent) || 0), 0);

    const marketPct = Math.max(0, 100 - assigned);

    // Rebuild allocations: keep assigned users, add/update Market
    loan.ownership.allocations = [
      ...loan.ownership.allocations.filter(a => a.user !== MARKET_USER),
      { user: MARKET_USER, percent: marketPct }
    ];
  }

  // 2. Normalize ownershipLots (create if missing or invalid)
  if (!Array.isArray(loan.ownershipLots) || loan.ownershipLots.length === 0) {
    const userAllocs = loan.ownership.allocations
      .filter(a => a.user !== MARKET_USER);

    if (userAllocs.length === 0) {
      // Dev fallback: full ownership to default user
      loan.ownershipLots = [{
        user: loan.user ?? "jeff",
        pct: 1,
        pricePaid: Number(loan.purchasePrice ?? loan.principal ?? 0),
        purchaseDate: loan.purchaseDate || loan.loanStartDate || null
      }];
    } else {
      // Create lots from allocations
      loan.ownershipLots = userAllocs.map(a => ({
        user: a.user,
        pct: (Number(a.percent) || 0) / 100,
        pricePaid: Number(loan.purchasePrice ?? loan.principal ?? 0),
        purchaseDate: loan.purchaseDate || loan.loanStartDate || null
      }));
    }
  }

  // 3. Derive top-level purchaseDate from earliest lot if missing
  // (this ensures round-trip consistency without overwriting manual values)
  if (!loan.purchaseDate && Array.isArray(loan.ownershipLots) && loan.ownershipLots.length > 0) {
    const validDates = loan.ownershipLots
      .map(lot => lot.purchaseDate?.trim())
      .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (validDates.length > 0) {
      validDates.sort();
      loan.purchaseDate = validDates[0];
    } else if (loan.loanStartDate) {
      loan.purchaseDate = loan.loanStartDate;
    }
  }

  // Optional: defensive cleanup - remove invalid lots
  loan.ownershipLots = loan.ownershipLots.filter(lot => 
    lot.user && Number(lot.pct) > 0 && lot.purchaseDate
  );

  console.log(`normalizeOwnership done for ${loan.loanId}: purchaseDate = ${loan.purchaseDate || '(missing)'}`);
  
}


// -------------------------------------
// Ownership helpers
// -------------------------------------
export function getUserOwnershipPct(loan, user) {
  const normalizedUser = String(user || '').trim().toLowerCase();

  if (Array.isArray(loan.ownershipLots)) {
    return loan.ownershipLots
      .filter(l => String(l.user || '').trim().toLowerCase() === normalizedUser)
      .reduce((sum, l) => sum + (Number(l.pct) || 0), 0);
  }

  // fallback for legacy data only
  return (
    loan.ownership?.allocations.find(a => String(a.user || '').trim().toLowerCase() === normalizedUser)?.percent ?? 0
  ) / 100;
}


export function isOwnedByUser(loan, user) {
  const userId =
    typeof user === "string"
      ? user
      : user?.id || user?.user || null;

  if (!userId) return false;

  return getUserOwnershipPct(loan, userId) > 0;
}

export function getMarketPct(loan) {
  return (
    loan.ownership?.allocations.find(a => a.user === MARKET_USER)?.percent ?? 0
  );
}
