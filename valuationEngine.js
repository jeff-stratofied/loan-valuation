/*
  valuationEngine.js
  ------------------
  Deterministic loan valuation engine for private student loans.
  Consumes loans.json, borrowers.json, and valuationCurves.json
  to produce loan-level cash flows and NPV.
*/

// ---- Valuation Profiles (Admin page driven) ----

import { getUserOwnershipPct } from "./ownershipEngine.js?v=dev";  
import { getBorrowerById } from "./borrowerStore.js?v=dev";    
import { getEffectiveBorrower } from "./valuationOverrides.js?v=dev"; 
import { buildAmortSchedule } from "./loanEngine.js?v=dev";

// System defaults (fallback values)
export let SYSTEM_PROFILE = {
  name: "system",
  assumptions: {
    recoveryRate: window.SYSTEM_RISK_CONFIG?.recoveryRate ?? 0.40,
    servicingCostBps: window.SYSTEM_RISK_CONFIG?.servicingCostBps ?? 50,
    prepaymentMultiplier: window.SYSTEM_RISK_CONFIG?.prepaymentMultiplier ?? 1.0,
    riskPremiumBps: window.SYSTEM_RISK_CONFIG?.riskPremiumBps ?? {
      LOW: 250,
      MEDIUM: 350,
      HIGH: 550,
      VERY_HIGH: 750
    },
    recoveryRate: window.SYSTEM_RISK_CONFIG?.recoveryRate ?? {
      LOW: 30,
      MEDIUM: 22,
      HIGH: 15,
      VERY_HIGH: 10
    },
    graduationRateThreshold: window.SYSTEM_RISK_CONFIG?.graduationRateThreshold ?? 75,
    earningsThreshold: window.SYSTEM_RISK_CONFIG?.earningsThreshold ?? 70000,
    ficoBorrowerAdjustment: window.SYSTEM_RISK_CONFIG?.ficoBorrowerAdjustment ?? 50,
    ficoCosignerAdjustment: window.SYSTEM_RISK_CONFIG?.ficoCosignerAdjustment ?? 25,
    baseRiskFreeRate: window.SYSTEM_RISK_CONFIG?.baseRiskFreeRate ?? 4.25,
    cdrMultiplier: window.SYSTEM_RISK_CONFIG?.cdrMultiplier ?? 1.0,
    prepaySeasoning: window.SYSTEM_RISK_CONFIG?.prepaySeasoning ?? 2.5,
    schoolTierMultiplier: window.SYSTEM_RISK_CONFIG?.schoolTierMultiplier ?? { A: 0.8, B: 1.0, C: 1.3, D: 1.5 },
    inflationAssumption: window.SYSTEM_RISK_CONFIG?.inflationAssumption ?? 3.0
  }
};


// User profile – loads from localStorage, falls back to system
export let USER_PROFILE = {
  name: "user",
  assumptions: { ...SYSTEM_PROFILE.assumptions }
};

export function loadUserProfile() {
  const raw = localStorage.getItem('userRiskAssumptions');
  if (raw) {
    try {
      const overrides = JSON.parse(raw);
      USER_PROFILE.assumptions = { ...SYSTEM_PROFILE.assumptions, ...overrides };
      console.log("Loaded user risk assumptions from localStorage");
    } catch (e) {
      console.warn("Invalid user assumptions in localStorage – using system defaults");
    }
  } else {
    console.log("No user risk overrides – using system defaults");
  }
}

export function saveUserProfile(overrides = {}) {
  localStorage.setItem('userRiskAssumptions', JSON.stringify(overrides));
  USER_PROFILE.assumptions = { ...SYSTEM_PROFILE.assumptions, ...overrides };
  console.log("Saved user risk assumptions");
}

// API endpoint
const CONFIG_API_URL = "https://loan-valuation-api.jeff-263.workers.dev/config";

// Load system config from backend (called once on page load)
export async function loadConfig() {
  try {
    const res = await fetch(CONFIG_API_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      // Remove sha if present (not needed in assumptions)
      const { sha, ...config } = data;
      SYSTEM_PROFILE.assumptions = { ...SYSTEM_PROFILE.assumptions, ...config };
      console.log("Loaded system assumptions from backend");
    } else {
      console.warn("Backend config not found – using defaults");
    }
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}

// Initialize on module load
loadConfig().catch(console.error);
      

// Run load immediately (since this is a module)
loadConfig().catch(err => console.error('Config init failed:', err));

// Still expose to window/UI if needed (e.g. for drawer debugging)
window.SYSTEM_PROFILE = SYSTEM_PROFILE;
window.USER_PROFILE = USER_PROFILE;

// ================================
// GLOBAL STATE (loaded once)
// ================================

export let VALUATION_CURVES = null;

// ================================
// SCHOOL TIER DATA (new)
// ================================

export let SCHOOLTIERS = null;

export async function loadSchoolTiers(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load school tiers from ${url}`);
  SCHOOLTIERS = await res.json();
}

export async function loadValuationCurves(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load valuation curves");
  VALUATION_CURVES = await res.json();
}

// ================================
// RISK DERIVATION
// ================================

export function deriveFicoBand(fico) {
  if (fico == null) return "UNKNOWN";
  if (fico >= 760) return "A";
  if (fico >= 720) return "B";
  if (fico >= 680) return "C";
  if (fico >= 640) return "D";
  return "E";
}

function computeSchoolTier(schoolData, assumptions) {
  const grad = schoolData.grad_rate || 0;
  const earn = schoolData.median_earnings_10yr || 50000;

  if (grad >= assumptions.graduationRateThreshold && earn >= assumptions.earningsThreshold) {
    return "Tier 1";
  } else if (grad >= assumptions.graduationRateThreshold * 0.8 || earn >= assumptions.earningsThreshold * 0.8) {
    return "Tier 2";
  } else {
    return "Tier 3";
  }
}

export function getSchoolTier(schoolName = "Unknown", opeid = null, assumptions = SYSTEM_PROFILE.assumptions) {
  if (!SCHOOLTIERS || typeof SCHOOLTIERS !== "object" || Object.keys(SCHOOLTIERS).length === 0) {
    console.debug("SCHOOLTIERS not ready yet – using default Tier 3");  // change to debug if you want to silence it
    return "Tier 3";
  }
  let schoolData;
  // Prefer OPEID (trim and check)
  if (opeid) {
    const trimmedOpeid = opeid.trim();
    schoolData = SCHOOLTIERS[trimmedOpeid];
    if (!schoolData) {
      console.warn(`OPEID ${trimmedOpeid} not found in SCHOOLTIERS — fallback to default`);
      schoolData = SCHOOLTIERS["DEFAULT"];
    }
  } else {
    console.warn(`No OPEID for school "${schoolName}" — default Tier 3`);
    schoolData = SCHOOLTIERS["DEFAULT"];
  }
  // Fallback for null earnings to prevent calculation errors
  if (schoolData.median_earnings_10yr === null) {
    schoolData.median_earnings_10yr = 50000; // Reasonable default fallback
  }
  return computeSchoolTier(schoolData, assumptions);
}

// ================================
// SCHOOL NAME RESOLUTION (added for UI display)
// ================================

export function getSchoolName(school = "", opeid = null) {
  // Prefer the explicit school name if it's provided and non-empty
  if (school && school.trim() !== "") {
    return school.trim();
  }

  // Fallback: look up full/official name from SCHOOLTIERS using OPEID
  if (opeid && SCHOOLTIERS) {
    const trimmedOpeid = opeid.trim();
    if (SCHOOLTIERS[trimmedOpeid]) {
      return SCHOOLTIERS[trimmedOpeid].name || 'Unknown';
    } else {
      console.warn(`OPEID ${trimmedOpeid} not found in SCHOOLTIERS for name lookup`);
    }
  }

  // Final fallback
  return 'Unknown';
}


function getSchoolAdjBps(tier) {
  const adjMap = {
    "Tier 1": -75,    // stronger positive (e.g., Ivy/elite → lower PD)
    "Tier 2":   0,
    "Tier 3": +125,   // bigger penalty for low-completion/low-earnings schools
    "Unknown": +100   // conservative default
  };
  return adjMap[tier] || +100;
}



export function deriveRiskTier(borrower = {}, assumptions = SYSTEM_PROFILE.assumptions) {
  const {
    borrowerFico = 0,
    cosignerFico = 0,
    yearInSchool = "Z",          // default to unknown
    isGraduateStudent = false
  } = borrower;

  // Blend FICO (borrower 70% weight)
  const alpha = 0.7;
  const blendedFico = Math.max(
    borrowerFico,
    alpha * borrowerFico + (1 - alpha) * cosignerFico
  );

  const band = deriveFicoBand(blendedFico);   // A/B/C/D/E

  // Year in School handling (string or number)
  let yearNum = typeof yearInSchool === "string" ? yearInSchool.toUpperCase() : String(yearInSchool);

  // Convert letter grades to numeric for logic
  const yearMap = { "A": 6, "B": 7, "C": 8, "D": 9, "Z": 1 };
  const effectiveYear = yearMap[yearNum] || parseInt(yearNum) || 1;

  let riskTier = "VERY_HIGH";

  if (band === "A" && effectiveYear >= 3) riskTier = "LOW";
  else if (["A", "B"].includes(band)) riskTier = "MEDIUM";
  else if (["C", "D"].includes(band)) riskTier = "HIGH";

  // Extra boost for very high FICO regardless of year
  if (blendedFico >= 780) riskTier = "LOW";
  else if (blendedFico >= 720 && riskTier === "HIGH") riskTier = "MEDIUM";

  return riskTier;
}

// ================================
// CASH FLOW HELPERS
// ================================

function monthlyRate(annualRate) {
  return annualRate / 12;
}

function discountFactor(rate, month) {
  return 1 / Math.pow(1 + rate / 12, month);
}

// ================================
// CORE VALUATION
// ================================


export function valueLoan({ loan, borrower, riskFreeRate = 0.04, profile }) {
  // Ensure valid profile
  if (!profile || !profile.assumptions) {
    console.warn("Invalid profile passed — using SYSTEM_PROFILE");
    profile = SYSTEM_PROFILE;
  }
  const assumptions = profile.assumptions;

  // -----------------------------
  // LOAN BASICS
  // -----------------------------
  const originalPrincipal = Number(loan.principal) || 0;
  const rate = Number(loan.nominalRate ?? loan.rate) || 0;
  const originalTermMonths = (Number(loan.termYears) || 10) * 12 + (Number(loan.graceYears) || 0) * 12;
  const inflationRate = assumptions.inflationAssumption / 100;

  if (originalPrincipal <= 0 || rate <= 0 || originalTermMonths <= 0) {
    console.warn(`Invalid loan basics for ${loan.loanId || loan.loanName}: principal=${originalPrincipal}, rate=${rate}, termMonths=${originalTermMonths}`);
    return {
      loanId: loan.loanId,
      riskTier: "UNKNOWN",
      discountRate: null,
      npv: NaN,
      npvRatio: null,
      expectedLoss: NaN,
      wal: NaN,
      irr: NaN
    };
  }

  const monthlyLoanRate = rate / 12;
  if (rate <= 0) {
    console.warn(`Forcing minimum rate 0.01 for loan ${loan.loanId || loan.loanName}`);
    rate = 0.01;
    monthlyLoanRate = rate / 12;
  }

  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  // ── Incorporate historical events via amort schedule ──
  const amort = buildAmortSchedule(loan);
  const today = new Date(); // Current date in code context
  const currentRow = amort.slice().reverse().find(r => r.loanDate <= today);
  let currentBalance = currentRow ? Number(currentRow.balance) : originalPrincipal;
  if (!Number.isFinite(currentBalance) || currentBalance < 0) currentBalance = 0;

  // Remaining months after current row
  const currentIndex = amort.indexOf(currentRow);
  const remainingMonths = currentIndex >= 0 ? amort.length - currentIndex - 1 : originalTermMonths;
  const termMonths = Math.max(remainingMonths, 1);

  if (currentBalance <= 0 || termMonths <= 0) {
    return {
      loanId: loan.loanId,
      riskTier: deriveRiskTier(borrower, assumptions),
      discountRate: riskFreeRate,
      npv: 0,
      npvRatio: 0,
      expectedLoss: 0,
      wal: 0,
      irr: 0,
      riskBreakdown: {},
      curve: null
    };
  }

  const principal = currentBalance;
  const monthlyPayment = computeMonthlyPayment(principal, rate, termMonths);

  // -----------------------------
  // RISK TIER & CURVE (FULLY USER-AWARE)
  // -----------------------------
  let riskTier = deriveRiskTier(borrower, profile.assumptions) || "HIGH";

  // Get base curve
  let curve = VALUATION_CURVES?.riskTiers[riskTier] || { riskPremiumBps: 550 };

  // USER OVERRIDES (from drawer)
  const userRiskBps = profile.assumptions.riskPremiumBps?.[riskTier] ?? curve.riskPremiumBps;
  const userRecoveryPct = (profile.assumptions.recoveryRate?.[riskTier] ?? curve.recovery?.grossRecoveryPct ?? 20) / 100;
  const userPrepayMultiplier = profile.assumptions.prepaymentMultiplier ?? 1.0;

  // FICO adjustments (now saved and active)
  const ficoAdj = (borrower.borrowerFico ? (profile.assumptions.ficoBorrowerAdjustment ?? 50) : 0) +
                  (borrower.cosignerFico ? (profile.assumptions.ficoCosignerAdjustment ?? 25) : 0);

  // Degree adjustment
  const normalizedDegree =
    borrower.degreeType === "STEM" ? "STEM" :
    borrower.degreeType === "Business" ? "BUSINESS" :
    borrower.degreeType === "Liberal Arts" ? "LIBERAL_ARTS" :
    borrower.degreeType === "Professional (e.g. Nursing, Law)" ? "PROFESSIONAL" :
    borrower.degreeType === "Other" ? "OTHER" :
    "UNKNOWN";

  const degreeAdj = profile.assumptions.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

  // School tier + adjustment
  const schoolTier = getSchoolTier(borrower.school, borrower.opeid, profile.assumptions);
  const schoolAdj = profile.assumptions.schoolAdjustmentsBps?.[schoolTier] ?? getSchoolAdjBps(schoolTier);

  // Year-in-school + graduate adjustments
  const yearKey = borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);
  const yearAdj = profile.assumptions.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;
  const gradAdj = borrower.isGraduateStudent ? (profile.assumptions.graduateAdjustmentBps ?? 0) : 0;

  // TOTAL RISK BPS (now includes FICO, degree, school, etc.)
  const totalRiskBps = userRiskBps + degreeAdj + schoolAdj + yearAdj + gradAdj + ficoAdj;

  // Override base risk-free rate from user profile
  const effectiveRiskFreeRate = (profile.assumptions.baseRiskFreeRate ?? riskFreeRate * 100) / 100;
  const cappedRiskBps = Math.min(totalRiskBps, 500);
  const discountRate = effectiveRiskFreeRate + cappedRiskBps / 10000;
  const monthlyDiscountRate = discountRate / 12;

  // -----------------------------
  // INTERPOLATE CURVES TO MONTHLY VECTORS
  // -----------------------------
  function interpolateCumulativeDefaultsToMonthlyPD(cumDefaultsPct, maxMonths) {
    const annualDefaults = cumDefaultsPct.map((cum, i) => (i === 0 ? cum : cum - cumDefaultsPct[i - 1]));
    const monthlyPD = [];
    for (let y = 0; y < annualDefaults.length && monthlyPD.length < maxMonths; y++) {
      const annualPD = annualDefaults[y] / 100;
      const monthly = 1 - Math.pow(1 - annualPD, 1 / 12);
      for (let m = 0; m < 12 && monthlyPD.length < maxMonths; m++) {
        monthlyPD.push(monthly);
      }
    }
    while (monthlyPD.length < maxMonths) {
      monthlyPD.push(monthlyPD[monthlyPD.length - 1] || 0);
    }
    return monthlyPD;
  }

  function interpolateAnnualCPRToMonthlySMM(annualCPRPct, maxMonths) {
    const monthlySMM = [];
    for (let y = 0; y < annualCPRPct.length && monthlySMM.length < maxMonths; y++) {
      const annualCPR = annualCPRPct[y] / 100;
      const smm = 1 - Math.pow(1 - annualCPR, 1 / 12);
      for (let m = 0; m < 12 && monthlySMM.length < maxMonths; m++) {
        monthlySMM.push(smm);
      }
    }
    while (monthlySMM.length < maxMonths) {
      monthlySMM.push(monthlySMM[monthlySMM.length - 1] || 0);
    }
    return monthlySMM;
  }

  const monthlyPD = interpolateCumulativeDefaultsToMonthlyPD(
    curve.defaultCurve.cumulativeDefaultPct,
    termMonths
  );
  const monthlySMM = interpolateAnnualCPRToMonthlySMM(
    curve.prepaymentCurve.valuesPct,
    termMonths
  );

  const recoveryPct = userRecoveryPct; // ← Use user override here
  const recoveryLag = curve.recovery.recoveryLagMonths;

  // -----------------------------
  // MONTHLY CASH FLOW LOOP
  // -----------------------------
  let balance = principal;
  let npv = 0;
  let totalDefaults = 0;
  let totalRecoveries = 0;
  let walNumerator = 0;
  let totalCF = 0;
  const cashFlows = [-principal];
  const recoveryQueue = new Array(termMonths + recoveryLag + 1).fill(0);

const startDate = new Date(currentRow ? currentRow.loanDate : loan.loanStartDate);
startDate.setDate(1);
const dateLabels = [];
  
  // --- NEW: structured monthly schedule for UI rendering ---
const monthlySchedule = [];
let cumulativeLossRunning = 0;


  // ── NEW: collect data for cash flow chart (purely observational) ──
  const projections = [];

  const monthlyInflation = Math.pow(1 + inflationRate, 1/12) - 1;

for (let m = 1; m <= termMonths; m++) {
  dateLabels.push(new Date(startDate.getFullYear(), startDate.getMonth() + (m - 1), 1));

  if (balance <= 0) {
    cashFlows.push(0);
    projections.push({
      month: m,
      principal: 0,
      interest: 0,
      discountedCF: 0,
      cumExpectedLoss: -(totalDefaults - totalRecoveries)
    });
    continue;
  }

  const interest = balance * monthlyLoanRate;

  // Grace period: interest-only (no principal reduction)
  let scheduledPayment = monthlyPayment;
  if (m <= (loan.graceYears || 0) * 12) {
    scheduledPayment = interest;
  }

  scheduledPayment = Math.min(scheduledPayment, balance + interest);

  const scheduledPrincipal = Math.max(0, scheduledPayment - interest);

// Prepayment on remaining after scheduled principal (no inflation on rate)
const remainingAfterScheduled = balance - scheduledPrincipal;
const baseSMM = monthlySMM[m - 1] || 0;

// Ramp-up logic: reduced effect before seasoning complete
const seasoningYears = profile.assumptions.prepaySeasoningYears ?? 2.5;
const seasoningMonths = seasoningYears * 12;
const multiplier = profile.assumptions.prepaymentMultiplier ?? 1.0;

const effectiveMultiplier = (m >= seasoningMonths) ? multiplier : multiplier * 0.1; // 90% reduction pre-seasoning
const adjustedSMM = baseSMM * effectiveMultiplier;
const prepay = remainingAfterScheduled * adjustedSMM;


// Apply reduced prepay before seasoning ends (e.g. 10% of normal rate)
const isSeasoned = m >= seasoningMonths;
const effectiveSMM = isSeasoned 
  ? baseSMM * userPrepayMultiplier 
  : baseSMM * userPrepayMultiplier * 0.1;  // 90% reduction pre-seasoning


  const totalPrincipalThisMonth = scheduledPrincipal + prepay;
  let remaining = remainingAfterScheduled - prepay;

  const defaultAmt = remaining * monthlyPD[m - 1];
  remaining -= defaultAmt;

  const recMonth = m + recoveryLag;
  if (recMonth < recoveryQueue.length) {
    recoveryQueue[recMonth] += defaultAmt * recoveryPct;
  } else {
    const lateRecovery = defaultAmt * recoveryPct;
    const discounted = lateRecovery / Math.pow(1 + monthlyDiscountRate, recMonth);
    npv += discounted;
    totalRecoveries += lateRecovery;
  }

  const recoveryThisMonth = recoveryQueue[m] || 0;

  const cashFlow = interest + totalPrincipalThisMonth + recoveryThisMonth;
  cashFlows.push(cashFlow);

  const discountedCF = cashFlow / Math.pow(1 + monthlyDiscountRate, m);
  npv += discountedCF;
  walNumerator += discountedCF * m;
  totalCF += discountedCF;

  totalDefaults += defaultAmt;
  totalRecoveries += recoveryThisMonth;

  cumulativeLossRunning += (defaultAmt - recoveryThisMonth);

  monthlySchedule.push({
    month: m,
    beginningBalance: balance,
    interest,
    scheduledPrincipal,
    prepayment: prepay,
    defaultAmount: defaultAmt,
    recovery: recoveryThisMonth,
    endingBalance: remaining,
    cashFlow,
    discountedCashFlow: discountedCF,
    cumulativeLoss: cumulativeLossRunning
  });

  balance = remaining;

  projections.push({
    month: m,
    principal: totalPrincipalThisMonth + recoveryThisMonth,
    interest: interest,
    discountedCF: discountedCF,
    cumExpectedLoss: -(totalDefaults - totalRecoveries)
  });
}

  const npvRatio = principal > 0 && Number.isFinite(npv)
    ? (npv / principal) - 1
    : 0;

  let expectedLoss = 0;
  if (principal > 0 && Number.isFinite(totalDefaults) && Number.isFinite(totalRecoveries)) {
    expectedLoss = (totalDefaults - totalRecoveries) / principal;
  }
  expectedLoss = Number.isFinite(expectedLoss) ? Math.max(0, expectedLoss) : 0;
  const expectedLossPct = expectedLoss;

  const wal = totalCF > 0 && Number.isFinite(walNumerator)
    ? walNumerator / totalCF / 12
    : 0;

  const irrPrincipal = currentBalance > 0 ? currentBalance : originalPrincipal;
  const irr = calculateIRR(cashFlows, irrPrincipal);
  const safeIrr = Number.isFinite(irr) ? irr : 0;

  return {
    loanId: loan.loanId,
    riskTier,
    discountRate,
    npv,
    npvRatio,
    expectedLoss,
    expectedLossPct,
    wal,
    irr: safeIrr,
    assumptions,
    riskBreakdown: {
      baseRiskBps: curve.riskPremiumBps,
      degreeAdj,
      schoolAdj,
      yearAdj,
      gradAdj,
      ficoAdj,
      totalRiskBps,
      schoolTier,
    },
    curve: VALUATION_CURVES?.riskTiers[riskTier] || null,
cashflowSchedule: monthlySchedule,
    dateLabels,
    projections
  };
}

// ================================
// PAYMENT MATH
// ================================

function computeMonthlyPayment(principal, annualRate, months) {
  const r = annualRate / 12;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

// Add this function (simple bisection IRR solver - no library needed)
export function calculateIRR(cashFlows, principal, guess = 0.1) {
  const MAX_ITER = 100;
  const PRECISION = 0.000001;

let min = 0;          // Start from 0% (no negative IRR allowed for these assets)
let max = 1.0;        // 100% monthly = 1200% annual — plenty
let irr = 0.008;      // ~10% annual monthly guess
  
  for (let i = 0; i < MAX_ITER; i++) {
    let npv = -principal;
    for (let t = 1; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + irr, t);
    }

    if (Math.abs(npv) < PRECISION) return irr * 12 * 100; // Annualize to %

    if (npv > 0) min = irr;
    else max = irr;

    irr = (min + max) / 2;
  }

const annualIrr = irr * 12 * 100;
return (Number.isFinite(annualIrr) && annualIrr >= -5) ? annualIrr : NaN;  // Allow slight negative, floor at -5%
}



export function computePortfolioValuation(loans, currentUser, ownershipMode, activeProfile, riskFreeRate) {
  const filteredLoans = loans.filter(loan => {
    const userPct = getUserOwnershipPct(loan, currentUser);
    const marketPct = getUserOwnershipPct(loan, "Market");
    if (ownershipMode === "portfolio") return userPct > 0;
    if (ownershipMode === "market") return marketPct > 0;
    if (ownershipMode === "all") return userPct > 0 || marketPct > 0;
    return false;
  });

  let totalPrincipal = 0;                    // owned invested amount
  let totalNPV = 0;                          // owned NPV $
  let totalExpectedLossWeighted = 0;         // for portfolio Exp Loss %
  let totalWALWeighted = 0;
  let totalIRRWeighted = 0;
  let totalPrincipalForWeights = 0;

  const valuedLoans = filteredLoans.map(loan => {
    const systemBorrower = getBorrowerById(loan.borrowerId) || {};
    const effectiveBorrower = getEffectiveBorrower({ loan, systemBorrower });

    loan.nominalRate = Number(loan.nominalRate ?? loan.rate ?? 0);
    if (loan.nominalRate <= 0) {
      console.warn(`Loan ${loan.loanName || loan.loanId} has rate=0 — using fallback`);
      loan.nominalRate = 0.08;
    }

    const profile = activeProfile;

    const valuation = valueLoan({
      loan,
      borrower: effectiveBorrower,
      riskFreeRate,
      profile
    });

    const amort = buildAmortSchedule(loan);
    const today = new Date();
    const currentRow = amort.slice().reverse().find(r => r.loanDate <= today);
    const currentBalance = currentRow ? Number(currentRow.balance) : Number(loan.principal);

    const userPct = getUserOwnershipPct(loan, currentUser);
    const marketPct = getUserOwnershipPct(loan, "Market");
    let ownershipPct = 1;
    if (ownershipMode === "portfolio") ownershipPct = userPct;
    else if (ownershipMode === "market") ownershipPct = marketPct;
    else if (ownershipMode === "all") ownershipPct = userPct > 0 ? userPct : marketPct;

    // Prorated values for owned portion
    const displayPrincipal  = loan.principal * ownershipPct;
    const displayNPV        = valuation.npv * ownershipPct;
    const displayExpLoss    = valuation.expectedLoss * ownershipPct;
    const displayExpLossPct = valuation.expectedLossPct;  // % stays loan-level
    const displayWAL        = valuation.wal;              // % stays loan-level
    const displayIRR        = valuation.irr;              // % stays loan-level
    displayExpLossPct: valuation.expectedLossPct ?? 0,

    // Accumulate owned totals
    totalPrincipal            += displayPrincipal;
    totalNPV                  += displayNPV;
    totalExpectedLossWeighted += valuation.expectedLossPct * displayPrincipal;
    totalWALWeighted          += valuation.wal * displayPrincipal;
    totalIRRWeighted          += valuation.irr * displayPrincipal;
    totalPrincipalForWeights  += displayPrincipal;
    
    return {
      ...loan,
      effectiveBorrower,
      valuation,
      amort,
      currentBalance,
      userPct,
      marketPct,
      ownershipPct,
      displayPrincipal,
      displayNPV,
      displayExpLoss,
      displayExpLossPct,
      displayWAL,
      displayIRR
    };
  });

  const totalNPVPercent = totalPrincipal > 0 ? ((totalNPV / totalPrincipal) - 1) * 100 : 0;
  const totalExpLoss    = totalPrincipalForWeights > 0 ? (totalExpectedLossWeighted / totalPrincipalForWeights) * 100 : 0;
  const totalWAL        = totalPrincipalForWeights > 0 ? totalWALWeighted / totalPrincipalForWeights : 0;
  const totalIRR        = totalPrincipalForWeights > 0 ? totalIRRWeighted / totalPrincipalForWeights : 0;


// ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
  // ADD THE DEBUG LOGS HERE
  console.group("Portfolio Exp Loss Debug — " + new Date().toISOString());
  console.log("totalExpectedLossWeighted =", totalExpectedLossWeighted);
  console.log("totalPrincipalForWeights   =", totalPrincipalForWeights);
  console.log("raw weighted avg (decimal) =", 
    totalPrincipalForWeights > 0 ? totalExpectedLossWeighted / totalPrincipalForWeights : "N/A");
  console.log("final totalExpLoss %       =", totalExpLoss);

  // Show contributing loans (only those with meaningful loss)
  console.log("Loans contributing to exp loss:");
  valuedLoans.forEach((vloan, i) => {
    if (vloan.valuation?.expectedLoss > 0.0001 || vloan.displayExpLoss > 0.0001) {
      console.log(
        `  ${i+1}. ${vloan.loanName || vloan.loanId}  ` +
        `expLoss=${(vloan.valuation?.expectedLoss || 0).toFixed(6)}  ` +
        `displayExpLoss=${(vloan.displayExpLoss || 0).toFixed(6)}  ` +
        `ownershipPct=${(vloan.ownershipPct || 0).toFixed(4)}  ` +
        `principal=${vloan.displayPrincipal?.toFixed(0) || "—"}`
      );
    }
  });

  const hasLoss = valuedLoans.some(l => (l.valuation?.expectedLoss || 0) > 0.001);
  console.log("Portfolio has any meaningful expected loss?", hasLoss ? "YES" : "NO");
  console.groupEnd();
  // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←



  
  return {
    valuedLoans,
    totalPrincipal,
    totalNPV,
    totalNPVPercent,
    totalExpLoss,
    totalWAL,
    totalIRR
  };
}
