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

export function normalizeOwnership(loan) {
  // -----------------------------
  // 1. Ensure allocation model
  // -----------------------------
  if (!loan.ownership) {
    loan.ownership = {
      unit: "percent",
      step: OWNERSHIP_STEP,
      allocations: [{ user: MARKET_USER, percent: 100 }]
    };
  }

  const assigned = loan.ownership.allocations
    .filter(a => a.user !== MARKET_USER)
    .reduce((s, a) => s + a.percent, 0);

  const marketPct = Math.max(0, 100 - assigned);

  loan.ownership.allocations = [
    ...loan.ownership.allocations.filter(a => a.user !== MARKET_USER),
    { user: MARKET_USER, percent: marketPct }
  ];

  // ------------------------------------------------
// 2. Normalize ownership into tranches (LOTS)
// ------------------------------------------------
if (!Array.isArray(loan.ownershipLots)) {
  const userAllocs = loan.ownership.allocations
    .filter(a => a.user !== MARKET_USER);

  // 🔑 DEV FALLBACK: assume full ownership by current user
  if (userAllocs.length === 0) {
    loan.ownershipLots = [{
      user: loan.user ?? "jeff",
      pct: 1,
      pricePaid: Number(loan.purchasePrice ?? 0),
      purchaseDate: loan.purchaseDate
    }];
  } else {
    loan.ownershipLots = userAllocs.map(a => ({
      user: a.user,
      pct: (Number(a.percent) || 0) / 100,
      pricePaid: Number(loan.purchasePrice ?? 0),
      purchaseDate: loan.purchaseDate
    }));
  }
}  
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
