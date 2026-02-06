// ===============================
// loanEngine.js  (NEW SHARED MODULE)
// ===============================

// -------------------------------
//  Helpers
// -------------------------------

import { loadLoans as fetchLoans } from "./loadLoans.js?v=dev";
import { isOwnedByUser } from "./ownershipEngine.js?v=dev"; 
import { USERS, getUserFeeWaiver } from "./users.js?v=dev";


// ------------------------------------
// User resolution (engine-owned truth)
// ------------------------------------
function resolveUserForLoan(loan) {
  // Preferred: explicit owner on loan
  if (loan.owner) return loan.owner;

  // Fallback: single ownershipLot
  if (
    Array.isArray(loan.ownershipLots) &&
    loan.ownershipLots.length === 1
  ) {
    return loan.ownershipLots[0].user;
  }

  // Fallback: legacy
  return loan.user || null;
}


// -------------------------------
//  Fees and Waivers
// -------------------------------
// ===============================
// Platform Configuration (GLOBAL)
// ===============================
export let GLOBAL_FEE_CONFIG = null;


export function setGlobalFeeConfig(fees) {
  GLOBAL_FEE_CONFIG = fees;
}


export function getMonthlyServicingRate(feeConfig) {  
  return (Number(feeConfig.monthlyServicingBps || 0) / 10000);  
}

export function resolveFeeWaiverFlags(userId, loan) {
  const userWaiver = getUserFeeWaiver(userId) || "none";  // ← Use helper from users.js
  const loanWaiver = loan?.feeWaiver || "none";

  // Loan-level override beats user-level
  const effectiveWaiver =
    loanWaiver !== "none" ? loanWaiver : userWaiver;

  // Normalize to tokens (supports "setup_grace", "setup+grace", etc)
  const tokens = effectiveWaiver
    .toLowerCase()
    .replace("+", "_")
    .split("_");

  return {
    waiveSetup: tokens.includes("setup") || tokens.includes("all"),
    waiveMonthly: tokens.includes("grace") || tokens.includes("all"),
    waiveAll: tokens.includes("all")
  };
}


// =======================================
// Canonical LOCAL date helpers (NO TZ BUG)
// =======================================
function parseISODateLocal(iso) {
  // ✅ Pass through real Date objects
  if (iso instanceof Date) {
    return iso;
  }

  // ✅ Null / undefined guard
  if (!iso) return null;

  // ✅ Parse ISO YYYY-MM-DD strings
  if (typeof iso === "string") {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // ❌ Anything else is a bug
  throw new Error(
    `[parseISODateLocal] Unsupported date input: ${String(iso)}`
  );
}

// ------------------------------------
// Load platform config (fees + users)
// ------------------------------------
export async function loadPlatformConfig(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load platform config: ${res.status}`);
  }

  const cfg = await res.json();

  // Fees only (users handled via users.js)
  GLOBAL_FEE_CONFIG = cfg.fees || {
    setupFee: 150,
    monthlyServicingBps: 25
  };

  return { fees: GLOBAL_FEE_CONFIG };  // No more users return
}


export function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


function monthKeyFromISO(iso) {
  return iso.slice(0, 7); // "YYYY-MM"
}

// ===============================
// UNIVERSAL LOAD + NORMALIZE
// ===============================
export async function loadLoans() {
  const raw = await fetchLoans();
  const items = Array.isArray(raw && raw.loans) ? raw.loans : [];
  return items.map((l, idx) => {
    const id = String(
      l.loanId !== undefined && l.loanId !== null
        ? l.loanId
        : (idx + 1)
    );
    // Normalize names
    const loanName =
      l.loanName ||
      l.name ||
      `Loan ${id}`;
    const school =
      l.school ||
      l.institution ||
      (loanName.includes(" ") ? loanName.split(" ")[0] : "School");
    // Normalize amounts
    const principal = Number(
      l.principal != null
        ? l.principal
        : l.origLoanAmt != null
        ? l.origLoanAmt
        : l.originalBalance != null
        ? l.originalBalance
        : l.purchasePrice != null
        ? l.purchasePrice
        : 0
    );
    const purchasePrice = Number(
      l.purchasePrice != null
        ? l.purchasePrice
        : l.buyPrice != null
        ? l.buyPrice
        : principal
    );

if (purchaseDate) {
  console.log(`Loan ${l.loanName || l.loanId}: using purchaseDate = ${purchaseDate} ` +
              `(from ${l.purchaseDate ? 'top-level' : 'ownership lot'})`);
} else {
  console.warn(`Loan ${l.loanName || l.loanId}: no usable purchaseDate at all`);
}
    
    const nominalRate = Number(
      l.rate != null
        ? l.rate
        : l.nominalRate != null
        ? l.nominalRate
        : 0
    );
    // Normalize dates
    const loanStartDate = normalizeDate(
      l.loanStartDate || l.startDate || ""
    );
    // Derive purchaseDate: Prefer top-level if present; otherwise, min from ownershipLots
    let purchaseDate = normalizeDate(l.purchaseDate || "");
    if (!purchaseDate && Array.isArray(l.ownershipLots) && l.ownershipLots.length > 0) {
      const lotDates = l.ownershipLots
        .map(lot => lot.purchaseDate)
        .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d))  // Filter valid ISO dates
        .sort((a, b) => new Date(a) - new Date(b));     // Sort ascending
      if (lotDates.length > 0) {
        purchaseDate = lotDates[0];  // Earliest date
      }
    }
    // Normalize terms
    const termYears = Number(
      l.termYears != null
        ? l.termYears
        : l.term != null
        ? l.term
        : 10
    );
    const graceYears = Number(
      l.graceYears != null
        ? l.graceYears
        : l.grace != null
        ? l.grace
        : 0
    );

    return {
  id,
  loanName,
  name: loanName,
  school,
  loanStartDate,
  purchaseDate,               // ← add this line (the derived one!)
  principal,
  purchasePrice,
  nominalRate,
  termYears,
  graceYears,
  events: Array.isArray(l.events) ? l.events : [],
  ownershipLots: Array.isArray(l.ownershipLots) ? l.ownershipLots : [],
  owner: l.owner || null,
  user: l.user || null,
  feeWaiver: l.feeWaiver || "none"
};
  });
}


export function addMonths(date, n) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("addMonths called with invalid Date");
  }

  return new Date(
    date.getFullYear(),
    date.getMonth() + n,
    1
  );
}




// ===============================
// Deferral helper (AUTHORITATIVE)
// ===============================
export function isDeferredMonth(row) {
  return row?.isDeferred === true;
}


// ===============================
// Standard portfolio start date
// ===============================
export function getPortfolioStartDate(loans = []) {
  const dates = loans
    .map(l => {
      const d = l.loanStartDate || l.purchaseDate;
      if (!d) return null;
      const dt = new Date(d + "T00:00:00");

      return Number.isFinite(dt.getTime()) ? dt : null;
    })
    .filter(Boolean);

  if (!dates.length) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  const min = new Date(Math.min(...dates.map(d => d.getTime())));
  min.setHours(0, 0, 0, 0);
  return min;
}

// ===============================
// Standard "today" (midnight)
// ===============================
export function getStandardToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ===============================
// Current schedule index (per-loan)
// ===============================
//
// Returns a 1-based index into amort.schedule
// Clamped to schedule length
//
export function getCurrentScheduleIndex(loan, asOf = new Date()) {
  if (!loan?.amort?.schedule?.length) return 1;

  const purchaseRaw = loan.purchaseDate || loan.loanStartDate || null;
const purchase = parseISODateLocal(purchaseRaw) || new Date();  // ultimate fallback to today
if (!purchaseRaw || isNaN(+purchase)) {
  console.warn(`Invalid/missing purchaseDate for loan ${loan.id}, using loanStartDate or today`);
}

  // Normalize to month boundary
  const purchaseMonth = new Date(
    purchase.getFullYear(),
    purchase.getMonth(),
    1
  );

  
  const asOfMonth = new Date(
    asOf.getFullYear(),
    asOf.getMonth(),
    1
  );

  const months =
    (asOfMonth.getFullYear() - purchaseMonth.getFullYear()) * 12 +
    (asOfMonth.getMonth() - purchaseMonth.getMonth()) + 1;

  return Math.min(
    Math.max(1, months),
    loan.amort.schedule.length
  );
}

function normalizeDate(d) {
  if (!d) return "";

  // If already ISO (YYYY-MM-DD), keep it
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  // Handle MM/DD/YYYY format and convert it to YYYY-MM-DD
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  console.warn("⚠️ Unrecognized date format:", d);
  return d; // Returning unmodified value for further debugging
}

function getEffectivePurchaseDate(loan) {
  return (
    parseISODateLocal(loan.purchaseDate) ||
    parseISODateLocal(loan.loanStartDate) ||
    new Date()
  );
}


// -------------------------------
// Core: Build amortization schedule
// -------------------------------
//
// This ensures:
// - consistent loanDate for each row
// - payment calculation aligned with loanStartDate
// - correct ownership logic using purchaseDate
//

export function buildAmortSchedule(loan) {
  console.log('loanStartDate type:', typeof loan.loanStartDate, loan.loanStartDate);

  const {
    principal,
    nominalRate,
    termYears,
    graceYears,
    loanStartDate,
    purchaseDate,
    events = []
  } = loan;

  const monthlyRate = nominalRate / 12;
  const graceMonths = graceYears * 12;
  const repaymentMonths = termYears * 12;
  const totalMonths = graceMonths + repaymentMonths;

  const originalMonthlyPayment = repaymentMonths > 0 
  ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -repaymentMonths))
  : 0;

  function normalizeDeferralFlags(row) {
    row.isDeferred =
      row.isDeferred === true ||
      row.deferral === true ||
      row.deferred === true;
    delete row.deferral;
    delete row.deferred;
    return row;
  }

  // Canonical dates (month-anchored)
  const start = parseISODateLocal(loanStartDate);
  if (!Number.isFinite(start?.getTime())) {
    throw new Error(
      `Invalid loanStartDate for loan "${loan.loanName}": ${loan.loanStartDate}`
    );
  }

console.log("Loan", loan.loanName || loan.id, {
  rawPurchaseDate:     loan.purchaseDate,
  rawLoanStartDate:    loan.loanStartDate,
  typeofPurchase:      typeof loan.purchaseDate,
  purchaseDatePresent: "purchaseDate" in loan,
  hasOwnershipLots:    Array.isArray(loan.ownershipLots) && loan.ownershipLots.length > 0,
});
  
// Canonical dates (month-anchored)
let purchase = parseISODateLocal(purchaseDate);

// Check if purchaseDate is valid after normalization
if (!purchase || !Number.isFinite(purchase.getTime())) {
  const fallback = parseISODateLocal(loan.loanStartDate);
  if (loan.purchaseDate !== undefined) {
    // only warn on malformed data, not just missing
    console.warn(`Invalid purchaseDate for "${loan.loanName || loan.id}": ${JSON.stringify(loan.purchaseDate)}. Using loanStartDate.`);
  } // else silent for pure missing → common & harmless
  purchase = fallback;
}


if (!purchase || !Number.isFinite(purchase.getTime())) {
  throw new Error(
    `Both purchaseDate and loanStartDate are invalid/missing for loan "${loan.loanName || loan.loanId || 'unknown'}"`
  );
}

  const purchaseMonth = new Date(purchase.getFullYear(), purchase.getMonth(), 1);

const userId = resolveUserForLoan(loan);
const user = USERS[userId] || { role: "investor", feeWaiver: "none" };

// Resolve fee waivers using userId (matches updated resolveFeeWaiverFlags signature)
const { waiveSetup, waiveMonthly, waiveAll } = resolveFeeWaiverFlags(userId, loan);
  
  const feeConfig =
    loan.feeConfig ||
    GLOBAL_FEE_CONFIG ||
    { setupFee: 150, monthlyServicingBps: 25 };

  const SETUP_FEE_AMOUNT = Number(feeConfig.setupFee || 0);
  const MONTHLY_SERVICING_RATE = getMonthlyServicingRate(feeConfig);

  // Prepayment events map
  const prepayMap = {};
  events
    .filter(e => e.type === "prepayment" && e.date)
    .forEach(e => {
      const key = monthKeyFromISO(e.date);
      if (!prepayMap[key]) prepayMap[key] = [];
      prepayMap[key].push(e);
    });

  // Deferral events map
  const deferralStartMap = {};
  events
    .filter(e => e.type === "deferral" && (e.startDate || e.date) && Number(e.months) > 0)
    .forEach(e => {
      const startISO = e.startDate || e.date;
      const key = monthKeyFromISO(startISO);
      const m = Math.max(0, Math.floor(Number(e.months) || 0));
      deferralStartMap[key] = (deferralStartMap[key] || 0) + m;
    });

  // Default event
  const defaultEvent = events.find(e => e.type === "default" && e.date);
  const defaultMonthKey = defaultEvent ? monthKeyFromISO(defaultEvent.date) : null;
  const defaultRecovery = defaultEvent ? Number(defaultEvent.recoveryAmount || 0) : 0;

  const schedule = [];

  // State
  let balance = Number(principal || 0);
  let calendarDate = new Date(start.getFullYear(), start.getMonth(), 1);
  let deferralRemaining = 0;
  let deferralTotal = 0;

  // Contractual month loop
  for (let i = 0; i < totalMonths; ) {
    const loanDate = new Date(calendarDate);
    const isOwned = loanDate >= purchaseMonth;
    const isFirstOwnedMonth =
      isOwned &&
      loanDate.getFullYear() === purchaseMonth.getFullYear() &&
      loanDate.getMonth() === purchaseMonth.getMonth();

    // Resolve fee waivers once per row (dynamic lookup)
    const { waiveSetup, waiveMonthly } = resolveFeeWaiverFlags(userId, loan);

    let feeThisMonth = 0;
    if (isFirstOwnedMonth && user.role === "lender" && !waiveSetup) {
      feeThisMonth += SETUP_FEE_AMOUNT;
    }
    if (isOwned && !waiveMonthly) {
      feeThisMonth += balance * MONTHLY_SERVICING_RATE;
    }

    // ==============================
    // DEFAULT (terminal)
    // ==============================
    if (defaultMonthKey && monthKeyFromDate(calendarDate) === defaultMonthKey) {
      const applied = Math.min(balance, defaultRecovery);
      balance -= applied;

      schedule.push(
        normalizeDeferralFlags({
          monthIndex: schedule.length + 1,
          loanDate,
          displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
          payment: +applied.toFixed(2),
          scheduledPrincipal: 0,
          prepaymentPrincipal: +applied.toFixed(2),
          principalPaid: +applied.toFixed(2),
          interest: 0,
          balance: +(balance).toFixed(2),
          accruedInterest: 0,
          feeThisMonth: +feeThisMonth.toFixed(2),
          prepayment: 0,
          isOwned,
          ownershipDate: isOwned ? loanDate : null,
          defaulted: true,
          isTerminal: true,
          recovery: +applied.toFixed(2),
          contractualMonth: i + 1
        })
      );
      break;
    }

    // ==============================
    // DEFERRAL START
    // ==============================
    const startKey = monthKeyFromDate(calendarDate);
    if (deferralRemaining === 0 && deferralStartMap[startKey]) {
      deferralRemaining = deferralStartMap[startKey];
      deferralTotal = deferralStartMap[startKey];
    }

    // ==============================
    // DEFERRAL MONTH
    // ==============================
    if (deferralRemaining > 0) {
      const accruedInterest = balance * monthlyRate;
      balance += accruedInterest;

      const key = monthKeyFromDate(loanDate);
      const monthEvents = prepayMap[key] || [];
      let prepaymentThisMonth = 0;
      monthEvents.forEach(e => {
        const amt = Number(e.amount || 0);
        if (amt > 0) {
          const applied = Math.min(balance, amt);
          prepaymentThisMonth += applied;
          balance -= applied;
        }
      });

      schedule.push(
        normalizeDeferralFlags({
          monthIndex: schedule.length + 1,
          loanDate,
          displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
          payment: 0,
          scheduledPrincipal: 0,
          prepaymentPrincipal: +prepaymentThisMonth.toFixed(2),
          principalPaid: +prepaymentThisMonth.toFixed(2),
          prepayment: +prepaymentThisMonth.toFixed(2),
          interest: 0,
          balance: +balance.toFixed(2),
          accruedInterest: +accruedInterest.toFixed(2),
          feeThisMonth: +feeThisMonth.toFixed(2),
          isDeferred: true,
          deferralIndex: deferralTotal - deferralRemaining,
          deferralRemaining,
          isOwned,
          ownershipDate: isOwned ? loanDate : null,
          contractualMonth: i + 1
        })
      );

      deferralRemaining--;
      calendarDate = addMonths(calendarDate, 1);
      i++;
      continue;
    }

// ==============================
// NORMAL MONTH
// ==============================
const interest = balance * monthlyRate;
let scheduledPrincipal = 0;
let prepaymentPrincipal = 0;
let paymentAmt = 0;

const monthsSinceLoanStart =
  (calendarDate.getFullYear() - start.getFullYear()) * 12 +
  (calendarDate.getMonth() - start.getMonth());

if (monthsSinceLoanStart < graceMonths) {
  balance += interest;
} else {
  paymentAmt = originalMonthlyPayment;
  scheduledPrincipal = Math.min(paymentAmt - interest, balance);
  balance = Math.max(0, balance - scheduledPrincipal);

  const threshold = 0.01;
  if (balance <= threshold) {
    balance = 0;
  }
}

    // Prepayments
    const eventKey = monthKeyFromDate(loanDate);
    const monthEvents = prepayMap[eventKey] || [];
    let prepaymentThisMonth = 0;
    monthEvents.forEach(e => {
      const amt = Number(e.amount || 0);
      if (amt > 0) {
        const applied = Math.min(balance, amt);
        prepaymentThisMonth += applied;
        balance -= applied;
      }
    });
    prepaymentPrincipal = prepaymentThisMonth;

    // Build row
    schedule.push(
      normalizeDeferralFlags({
        monthIndex: schedule.length + 1,
        loanDate,
        displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
        payment: +paymentAmt.toFixed(2),
        scheduledPrincipal: +scheduledPrincipal.toFixed(2),
        prepaymentPrincipal: +prepaymentPrincipal.toFixed(2),
        principalPaid: +(scheduledPrincipal + prepaymentPrincipal).toFixed(2),
        prepayment: +prepaymentPrincipal.toFixed(2),
        interest: +interest.toFixed(2),
        balance: +balance.toFixed(2),
        accruedInterest: 0,
        feeThisMonth: +feeThisMonth.toFixed(2),
        isDeferred: false,
        deferralIndex: null,
        deferralRemaining: null,
        isOwned,
        ownershipDate: isOwned ? loanDate : null,
        contractualMonth: i + 1
      })
    );

    // Advance month
    calendarDate = addMonths(calendarDate, 1);
    i++;

    // Early paid-off check
    if (balance <= 0) {
      schedule[schedule.length - 1].isTerminal = true;
      schedule[schedule.length - 1].isPaidOff = true;
      schedule[schedule.length - 1].maturityDate = calendarDate;
      console.log(`Loan paid off early on month: ${calendarDate.toISOString().slice(0, 10)}`);
      break;
    }
  }

  // Cumulative fields (only for owned periods)
  let cumP = 0, cumI = 0, cumPay = 0;
  schedule.forEach(r => {
    if (r.isOwned !== false) {
      cumP += r.principalPaid;
      cumI += r.interest;
      cumPay += r.payment;
    }
    r.cumPrincipal = +cumP.toFixed(2);
    r.cumInterest = +cumI.toFixed(2);
    r.cumPayment = +cumPay.toFixed(2);
  });

  if (schedule.length) {
    const last = schedule[schedule.length - 1];
    last.isPaidOff = last.balance <= 0;
  }

  return schedule;
}


export function getCanonicalCurrentAmortRow(schedule, today = new Date()) {
  if (!schedule?.length) return null;

  const y = today.getFullYear();
  const m = today.getMonth();

  const match = schedule.find(r =>
    r.loanDate &&
    r.loanDate.getFullYear() === y &&
    r.loanDate.getMonth() === m &&
    r.isOwned !== false
  );

  if (match) return match;

  return schedule.filter(r => r.isOwned !== false).at(-1) || schedule.at(-1);
}

// loanEngine.js
export function getCurrentLoanBalance(loan, today = new Date()) {
  const sched = loan?.amort?.schedule || loan?.cumSchedule || [];
  const row = getCanonicalCurrentAmortRow(sched, today);
  return Number(row?.balance || 0);
}


// -------------------------------
// Attach schedules to all loans
// -------------------------------

export function attachSchedules(input) {
  let loans = input;

  return loans.map(loan => ({
    ...loan,
    amort: { schedule: buildAmortSchedule(loan) }
  }));
}

export function buildPortfolioViews(loansWithAmort) {
  
  const TODAY = new Date();
  const nextMonthDate = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 1);

  // ----------------------------------------------
  // 1) Next-Month Expected Income (Option A)
  // ----------------------------------------------
  function sameMonthYear(d1, d2) {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth()
    );
  }

  function calcMonthlyExpectedIncome(targetMonthDate) {
    return loansWithAmort.reduce((sum, loan) => {
      const purchaseDate = parseISODateLocal(loan.purchaseDate) 
  || parseISODateLocal(loan.loanStartDate) 
  || new Date();  // fallback to today if both missing

      return sum + loan.amort.schedule
        .filter(r => {
          const payDate = r.loanDate;
          const sameMonth = sameMonthYear(payDate, targetMonthDate);
          return sameMonth && owned;
        })
        .reduce((s, r) => s + r.payment, 0);
    }, 0);
  }

  // Default: 24-month forward projection
  const forwardMonths = 24;
  const incomeLabels = [];
  const incomePayments = [];

  for (let i = 0; i < forwardMonths; i++) {
    const d = new Date(nextMonthDate);
    d.setMonth(d.getMonth() + i);

    incomeLabels.push(
      d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    );
    incomePayments.push(calcMonthlyExpectedIncome(d));
  }

  const monthlyIncomeKpi = calcMonthlyExpectedIncome(nextMonthDate);


  // ----------------------------------------------
  // 2) ROI Series (per-loan & portfolio)
  // ----------------------------------------------
  //
  // ROI definition:
  //
  //   ROI = (CurrentValue - PurchasePrice) / PurchasePrice
  //
  // CurrentValue = principal remaining + cumulative interest earned
  //
  // Everything aligned to loanDate.

    const roiSeries = {};
  const roiKpis = {};

  loansWithAmort.forEach(loan => {
    const purchase = getEffectivePurchaseDate(loan);
const purchasePrice = Number(loan.purchasePrice ?? loan.principal ?? 0);

    let cumInterest  = 0;
    let cumPrincipal = 0;
    let cumFees      = 0;

    roiSeries[loan.id] = loan.amort.schedule
      .filter(r => r.loanDate >= purchase)
.map(r => {
  // accumulate realized components
  cumInterest  += r.interest;
  cumPrincipal += getTotalPrincipalPaid(r);
  
  const feeThisMonth = Number(r.feeThisMonth ?? 0);
  cumFees += feeThisMonth;

  const realized   = cumPrincipal + cumInterest - cumFees;
  const unrealized = r.balance * 0.95;
  const loanValue  = realized + unrealized;

  const roi = purchasePrice
    ? (loanValue - purchasePrice) / purchasePrice
    : 0;

  return {
    date: r.loanDate,
    month: r.monthIndex,
    roi,
    loanValue,
    realized,
    unrealized,
    balance: r.balance,
    cumInterest,
    cumPrincipal,
    cumFees,
    ownershipDate: r.ownershipDate
  };
});



    // Latest ROI KPI for this loan (last point in its series)
    roiKpis[loan.id] =
      roiSeries[loan.id].length > 0
        ? roiSeries[loan.id][roiSeries[loan.id].length - 1].roi
        : 0;
  });

  

// ----------------------------------------------
// 3) Earnings Timeline (CANONICAL, MONTHLY)
// ----------------------------------------------
//
// Emits a full, gap-free monthly timeline from loanStartDate
// UI must render this directly (no inference)
// ----------------------------------------------

const earningsTimeline = {};
const earningsKpis = {};

loansWithAmort.forEach(loan => {
const start = parseISODateLocal(loan.loanStartDate);
const purchase = parseISODateLocal(loan.purchaseDate) || start;

if (!start) {
  console.error(`Invalid loanStartDate for loan ${loan.id}:`, loan.loanStartDate);
  // Optionally return early or set a fallback
}

  let cumPrincipal = 0;
  let cumInterest  = 0;
  let cumFees      = 0;

  const timeline = loan.amort.schedule.map(r => {
    const owned = r.loanDate >= purchase;

    // suppress earnings pre-ownership
    const principal = owned ? getTotalPrincipalPaid(r) : 0;
    const interest  = owned ? r.interest       : 0;
    const fees      = owned ? Number(r.feeThisMonth ?? 0) : 0;

    cumPrincipal += principal;
    cumInterest  += interest;
    cumFees      += fees;

    return {
      loanDate: r.loanDate,
      monthIndex: r.monthIndex,

      // ownership flags (engine-owned truth)
      isOwned: owned,
      ownershipDate: owned ? r.loanDate : null,
      isDeferred: r.isDeferred === true,
      defaulted: r.defaulted === true,

      // incremental
      monthlyPrincipal: principal,
      monthlyInterest: interest,
      monthlyFees: fees,
      monthlyNet: principal + interest - fees,

      // cumulative
      cumPrincipal,
      cumInterest,
      cumFees,
      netEarnings: cumPrincipal + cumInterest - cumFees,

      balance: r.balance
    };
  });


  
// -------------------------------------------------
// DISPLAY timeline (INVESTOR VIEW — starts at first owned month)
// -------------------------------------------------

const firstOwnedIdx = timeline.findIndex(r => r.isOwned === true);

const displayTimeline =
  firstOwnedIdx >= 0
    ? timeline.slice(firstOwnedIdx)
    : [];

  
  earningsTimeline[loan.id] = timeline;
loan.displayEarningsTimeline = displayTimeline;


  earningsKpis[loan.id] =
    timeline.length > 0
      ? timeline[timeline.length - 1].netEarnings
      : 0;
});

  // ----------------------------------------------
  // 4) Amort KPIs (Total Invested, Portfolio Value, etc.)
  // ----------------------------------------------

  const totalInvested = loansWithAmort.reduce((sum, loan) => {
    return sum + loan.principal;
  }, 0);

  const portfolioValue = loansWithAmort.reduce((sum, loan) => {
    const last = loan.amort.schedule[loan.amort.schedule.length - 1];
    return sum + last.balance;
  }, 0);

  const amortKpis = {
    totalInvested,
    portfolioValue,
    monthlyIncomeKpi,
    nextMonthLabel: nextMonthDate.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric"
    })
  };



  // ----------------------------------------------
  // Return unified views
  // ----------------------------------------------

return {
  loans: loansWithAmort,

  // amort page data
  incomeLabels,
  incomePayments,
  amortKpis,

  // ROI page data
  roiSeries,
  roiKpis,

  // earnings page data (canonical)
earningsTimeline,
earningsKpis

};
}
