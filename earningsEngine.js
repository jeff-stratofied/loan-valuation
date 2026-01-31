 /**
 * ============================================================
 * Earnings Engine
 * ------------------------------------------------------------
 * Pure domain logic for computing earnings from amort schedules.
 *
 * - No DOM access
 * - No global state
 * - No page knowledge
 * - Deterministic outputs
 *
 * Designed for:
 * - Earnings UI
 * - Paper portfolios
 * - Future reuse / testing
 * ============================================================
 */
 
import {
  addMonths,
  isDeferredMonth,
   GLOBAL_FEE_CONFIG,
  USERS,
  resolveFeeWaiverFlags,     // ← we'll use this later
  getMonthlyServicingRate    // ← we'll use this later
} from "./loanEngine.js?v=dev";


/* ============================================================
   Helpers (local, pure)
   ============================================================ */

function monthDiff(d1, d2) {
  if (!(d1 instanceof Date) || !(d2 instanceof Date)) return 0;
  return (
    (d2.getFullYear() - d1.getFullYear()) * 12 +
    (d2.getMonth() - d1.getMonth())
  );
}

// Duplicate parseISODateLocal from loanEngine.js for consistency (local date parsing)
function parseISODateLocal(iso) {
  if (iso instanceof Date) return iso;
  if (!iso) return null;
  if (typeof iso === "string") {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  throw new Error(`[parseISODateLocal] Unsupported date input: ${String(iso)}`);
}

function getOwnershipPctForMonth(ownershipLots, loanDate, user) {
  if (!Array.isArray(ownershipLots)) return 0;

  return ownershipLots.reduce((sum, lot) => {
    if (lot.user !== user) return sum;

    const start = parseISODateLocal(lot.purchaseDate);
    if (!start || loanDate < start) return sum;

    return sum + Number(lot.pct || 0);
  }, 0);
}



/* ============================================================
   Core: Build Earnings Schedule
   ============================================================ */

/**
 * Build a full earnings schedule from an amort schedule.
 *
 * @param {Object} params
 * @param {Array}  params.amortSchedule   LoanEngine amort rows
 * @param {string} params.loanStartDate   YYYY-MM-DD
 * @param {string} params.purchaseDate    YYYY-MM-DD
 * @param {Array}  params.events          Loan events
 * @param {Date}   params.today           Canonical "today"
 *
 * @returns {Array<EarningsRow>}
 */

export function buildEarningsSchedule({
  amortSchedule,
  loanStartDate,
  ownershipLots = [],
  user,
  events = [],
  today
}) {
  if (!Array.isArray(amortSchedule) || amortSchedule.length === 0) {
    return [];
  }

  // 🔒 HARD GUARDS (match amort engine behavior)
  const loanStart = parseISODateLocal(loanStartDate);
  if (!Number.isFinite(loanStart.getTime())) {
    throw new Error(`Invalid loanStartDate in earnings engine: ${loanStartDate}`);
  }

 
// Use loaded platform config (with fallbacks)
const setupFeeAmount = GLOBAL_FEE_CONFIG?.setupFee ?? 150;
const monthlyRate = (GLOBAL_FEE_CONFIG?.monthlyServicingBps ?? 25) / 10000;

// Waiver flags for this user (loan override not yet supported here)
const userObj = USERS[user] || { feeWaiver: "none" };
const resolvedUser =
  USERS?.[userObj.id] ||
  USERS?.[userObj.userId] ||
  userObj;

 
const { waiveSetup, waiveMonthly, waiveAll } =
  resolveFeeWaiverFlags(resolvedUser, {});
 
  // ----------------------------------------------------------
  // Normalize amort rows with ownership + calendar dates
  // (LOT-AWARE: ownership can change over time)
  // ----------------------------------------------------------
const normalized = amortSchedule.map((row, idx) => {
  const loanDateRaw = addMonths(loanStart, row.monthIndex - 1);
  const loanDate = new Date(
    loanDateRaw.getFullYear(),
    loanDateRaw.getMonth(),
    1
  );

  // Ownership pct active for this calendar month
  const ownershipPct = Array.isArray(ownershipLots)
    ? ownershipLots.reduce((sum, lot) => {
        if (!lot || lot.user !== user) return sum;

        const start = parseISODateLocal(lot.purchaseDate);
        if (!(start instanceof Date) || !Number.isFinite(start.getTime())) return sum;

        // lot becomes active starting its purchase month
        const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
        return loanDate >= startMonth ? sum + Number(lot.pct || 0) : sum;
      }, 0)
    : 0;

  const isOwned = ownershipPct > 0;
  const isFirstPeriod = idx === 0;   // ✅ ADD THIS

  return {
    ...row,
    loanDate,
    ownershipPct,
    isOwned,
    isFirstPeriod                // ✅ AND EXPOSE IT
  };
});

  // ----------------------------------------------------------
  // Earnings accumulation (AUTHORITATIVE)
  // ----------------------------------------------------------
  let cumPrincipal = 0;
  let cumInterest = 0;
  let cumFees = 0;

  let prevCumPrincipal = 0;
  let prevCumInterest = 0;
  let prevCumFees = 0;

  const earnings = normalized.map(row => {
    const deferred = isDeferredMonth(row);

    // ---- fees ----
    // Upfront fee applies ONCE when ownership first becomes active.
    // We implement this per-lot by charging $150 for each lot in its start month,
    // and scaling by that lot's pct.
    let upfrontFeeThisMonth = 0;
if (row.isOwned && Array.isArray(ownershipLots) && !waiveAll && !waiveSetup) {
  upfrontFeeThisMonth = ownershipLots.reduce((sum, lot) => {
    if (!lot || lot.user !== user) return sum;
    const start = parseISODateLocal(lot.purchaseDate);
    if (!(start instanceof Date) || !Number.isFinite(start.getTime())) return sum;
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    if (row.loanDate.getTime() !== startMonth.getTime()) return sum;
    return sum + setupFeeAmount * Number(lot.pct || 0);
  }, 0);
}

    const balance = Number(row.balance ?? 0);

    // Monthly balance fee scales by active ownership pct
   // Monthly servicing fees ONLY when a payment is made
const isPayingMonth = Number(row.payment || 0) > 0;

let monthlyBalanceFee = 0;

if (
  row.isOwned &&
  balance > 0 &&
  isPayingMonth &&   // 🔑 HARD RULE
  !waiveAll
) {
  monthlyBalanceFee =
    +((balance * monthlyRate) * Number(row.ownershipPct || 0)).toFixed(2);
}

    const feeThisMonth = upfrontFeeThisMonth + monthlyBalanceFee;

    // ---- principal / interest (PAID, NOT ACCRUED) ----
    let principalThisMonth = 0;
    let interestThisMonth = 0;
    let feesThisMonth = 0;

    if (row.isOwned && !deferred) {
      const scale = Number(row.ownershipPct || 0);

      principalThisMonth = Math.max(
        0,
        (Number(row.principalPaid || 0) - Number(row.prepayment || 0))
      ) * scale;

      // 🔑 PAID INTEREST = amort interest AFTER grace only
      interestThisMonth =
        (Number(row.payment || 0) > 0 ? Number(row.interest || 0) : 0) * scale;

      feesThisMonth = feeThisMonth;
    }

    // 🔒 DEV INVARIANT: only warn if it's a repayment month (payment > 0)
    if (
      row.isOwned &&
      !deferred &&
      Number(row.payment || 0) > 0 &&
      Number(row.interest || 0) > 0 &&
      interestThisMonth === 0
    ) {
      console.warn(
        "[EARNINGS] Interest unexpectedly zero in repayment month",
        {
          loanId: row.loanId,
          monthIndex: row.monthIndex,
          payment: row.payment,
          interest: row.interest,
          interestThisMonth,
          row
        }
      );
    }

    // 🔒 EXPLICIT GRACE RULE (defensive)
    if (deferred) {
      principalThisMonth = 0;
      interestThisMonth = 0;
      feesThisMonth = feeThisMonth; // fees may still apply
    }

    // ---- normalize cents ----
    principalThisMonth = +Number(principalThisMonth || 0).toFixed(2);
    interestThisMonth  = +Number(interestThisMonth  || 0).toFixed(2);
    feesThisMonth      = +Number(feesThisMonth      || 0).toFixed(2);

    // ---- accumulate ONCE ----
    cumPrincipal = +(cumPrincipal + principalThisMonth).toFixed(2);
    cumInterest  = +(cumInterest  + interestThisMonth).toFixed(2);
    cumFees      = +(cumFees      + feesThisMonth).toFixed(2);

    const netEarnings = +(cumPrincipal + cumInterest - cumFees).toFixed(2);

    // ---- monthly deltas ----
    const monthlyPrincipal = +(cumPrincipal - prevCumPrincipal).toFixed(2);
    const monthlyInterest  = +(cumInterest  - prevCumInterest ).toFixed(2);
    const monthlyFees      = +(cumFees      - prevCumFees     ).toFixed(2);
    const monthlyNet       = +(monthlyPrincipal + monthlyInterest - monthlyFees).toFixed(2);

    prevCumPrincipal = cumPrincipal;
    prevCumInterest  = cumInterest;
    prevCumFees      = cumFees;

    return {
      ...row,
      // cumulative
      cumPrincipal,
      cumInterest,
      cumFees,
      netEarnings,
      // monthly
      monthlyPrincipal,
      monthlyInterest,
      monthlyFees,
      monthlyNet,
      // overrides (truthful reporting)
      feeThisMonth,
      interestPaid: interestThisMonth,
      principalPaid: principalThisMonth,
      isDeferralMonth: deferred
    };
  });

  // 🔑 IMPORTANT FIX: Only return owned rows
  const ownedEarnings = earnings.filter(
    r => r.isOwned === true && Number(r.ownershipPct || 0) > 0
  );

  if (ownedEarnings.length === 0) {
    return [];
  }

  // Final validation + sort
  return ownedEarnings
    .map(r => {
      if (!(r.loanDate instanceof Date) || !Number.isFinite(r.loanDate.getTime())) {
        throw new Error("Invalid loanDate generated in earnings engine");
      }
      return r;
    })
    .sort((a, b) => a.loanDate - b.loanDate);
}



/* ============================================================
   Canonical "Current" Row
   ============================================================ */

/**
 * Returns the authoritative "current" earnings row.
 *
 * Rules:
 * 1. Prefer calendar month match with today
 * 2. Fallback to last owned row
 * 3. Final fallback to last row
 */
export function getCanonicalCurrentEarningsRow(
  earningsSchedule,
  today
) {
  if (!Array.isArray(earningsSchedule) || !earningsSchedule.length) {
    return null;
  }

  const y = today.getFullYear();
  const m = today.getMonth();

  const match = earningsSchedule.find(r =>
    r.loanDate &&
    r.loanDate.getFullYear() === y &&
    r.loanDate.getMonth() === m
  );

  if (match) return match;

  return (
    earningsSchedule.filter(r => r.isOwned).at(-1) ||
    earningsSchedule.at(-1)
  );
}

/* ============================================================
   Portfolio KPIs
   ============================================================ */

/**
 * Compute portfolio-level earnings KPIs.
 *
 * @param {Array} loansWithEarnings
 * @param {Date}  today
 * @param {Date}  portfolioStartDate
 */
export function computePortfolioEarningsKPIs(
  loansWithEarnings,
  today,
  portfolioStartDate
) {
  let totalNetToDate = 0;
  let totalNetProjected = 0;
  let totalFeesToDate = 0;
  let totalFeesProjected = 0;
  let totalPrincipal = 0;

  // For KPI2 table only (lifetime totals per loan)
  const kpi2Rows = [];

  // 🔑 Portfolio monthly aggregation keyed by YYYY-M (calendar months)
  const monthlyNetByMonth = new Map();

  loansWithEarnings.forEach(l => {
    totalPrincipal += Number(l.purchasePrice || 0) * Number(l.ownershipPct || 0);

    const sched = Array.isArray(l.earningsSchedule) ? l.earningsSchedule : [];
    if (!sched.length) return;

    const atEnd = sched[sched.length - 1];

    // KPI2 table row (lifetime)
    kpi2Rows.push({
      loanId: l.loanId,
      loanName: l.loanName,
      school: l.school,
      netEarnings: Number(atEnd.netEarnings || 0),
      principal: Number(atEnd.cumPrincipal || 0),
      interest: Number(atEnd.cumInterest || 0),
      fees: -Number(atEnd.cumFees || 0)
    });

    // Portfolio projected totals (lifetime)
    totalNetProjected += Number(atEnd.netEarnings || 0);
    totalFeesProjected += Number(atEnd.cumFees || 0);

// =====================================================
// KPI1 — CALENDAR-BASED CASH FLOW (MATCH CHART EXACTLY)
// =====================================================
let loanNetToDate = 0;
let loanFeesToDate = 0;

sched.forEach(r => {
  if (!r || r.isOwned !== true) return;
  if (!(r.loanDate instanceof Date)) return;
  if (r.loanDate > today) return;

  loanNetToDate  += Number(r.monthlyNet  || 0);
  loanFeesToDate += Number(r.monthlyFees || 0);
});

totalNetToDate  += loanNetToDate;
totalFeesToDate += loanFeesToDate;


    // 🔑 Accumulate MONTHLY net (this is what supports the true avg definition)
    // Only include owned months up to "today"
    sched.forEach(r => {
      if (!r || r.isOwned !== true) return;
      if (!(r.loanDate instanceof Date) || !Number.isFinite(r.loanDate.getTime())) return;
      if (r.loanDate > today) return;

      const key = `${r.loanDate.getFullYear()}-${r.loanDate.getMonth()}`;
      const prev = monthlyNetByMonth.get(key) || 0;
      monthlyNetByMonth.set(key, prev + Number(r.monthlyNet || 0));
    });
  });

  // 🔑 Months counted = calendar months elapsed since portfolio start (time-based, not earnings-based)
let monthsCounted = 0;

if (portfolioStartDate instanceof Date && Number.isFinite(portfolioStartDate.getTime())) {
  const start = new Date(
    portfolioStartDate.getFullYear(),
    portfolioStartDate.getMonth(),
    1
  );

  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  monthsCounted = Math.max(0, monthDiff(start, end) + 1);
}


  // True avg monthly earnings to date
  const avgMonthlyNet =
    monthsCounted > 0
      ? totalNetToDate / monthsCounted
      : 0;

  // Projected avg monthly (lifetime): divide total projected by max months through maturity (portfolio timeline)
  const maxMonthsThroughMaturity = loansWithEarnings.reduce(
    (max, l) => Math.max(max, (l.earningsSchedule || []).length),
    0
  );
const projectedAvgMonthlyNet =
  maxMonthsThroughMaturity > 0
    ? totalNetProjected / maxMonthsThroughMaturity
    : 0;

// 🔒 DEV INVARIANT — calendar time must dominate earnings rows
if (monthsCounted > 0 && monthlyNetByMonth.size > monthsCounted) {
  console.warn(
    "[EARNINGS KPI] Monthly earnings rows exceed calendar month count",
    {
      monthsCounted,
      monthlyMonths: monthlyNetByMonth.size,
      portfolioStartDate,
      today
    }
  );
}

return {
  totalNetToDate,
  totalNetProjected,
  totalFeesToDate,
  totalFeesProjected,
  totalPrincipal,

  // ✅ KPI3
  avgMonthlyNet,
  monthsCounted,

  // ✅ KPI4
  projectedAvgMonthlyNet,
  monthsThroughMaturity: maxMonthsThroughMaturity,

  // KPI2 table
  kpi2Rows
};
}




