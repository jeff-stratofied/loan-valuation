/*
  valuationEngine.js
  ------------------
  Deterministic loan valuation engine for private student loans.
  Consumes loans.json, borrowers.json, and valuationCurves.json
  to produce loan-level cash flows and NPV.  
*/

// ---- Valuation Profiles (Admin page driven) ----

// Dynamic profiles loaded from backend
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

export let USER_PROFILE = {
  name: "user",
  assumptions: { ...SYSTEM_PROFILE.assumptions }  // start with system defaults, override if user-specific
};

// API endpoint (match whatever you set in admin.html)
const CONFIG_API_URL = "https://loan-valuation-api.jeff-263.workers.dev/config";

// Load config from backend on module init
async function loadConfig() {
  try {
    const res = await fetch(CONFIG_API_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      // Merge into SYSTEM_PROFILE.assumptions (backend wins)
      SYSTEM_PROFILE.assumptions = { ...SYSTEM_PROFILE.assumptions, ...data };
      
      // If you want user-specific overrides later, fetch ?user=jeff and merge into USER_PROFILE
      console.log('Loaded updated assumptions:', SYSTEM_PROFILE.assumptions);
    } else {
      console.warn('No config found on backend — using defaults');
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

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

function getSchoolTier(schoolName = "Unknown", opeid = null) {
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
  return schoolData.tier || "Tier 3";
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



export function deriveRiskTier({ borrowerFico, cosignerFico, yearInSchool, isGraduateStudent }) {
  const alpha = 0.7; // Calibrate later (0.6-0.8)
const blendedFico = borrowerFico
  ? Math.max(borrowerFico, alpha * borrowerFico + (1 - alpha) * (cosignerFico || borrowerFico))
  : cosignerFico || 0;
const fico = blendedFico;
  const band = deriveFicoBand(fico);

  // Simple, conservative base logic (expand later)
  if (band === "A" && yearInSchool >= 3) return "LOW";
  if (["A", "B"].includes(band)) return "MEDIUM";
  if (["C", "D"].includes(band)) return "HIGH";
  return "VERY_HIGH";

  let finalRiskTier = riskTier;
if (schoolTier === "Tier 1" && ["MEDIUM", "HIGH"].includes(riskTier)) {
  finalRiskTier = "LOW";  // promotion for elite schools
} else if (schoolTier === "Tier 3" && riskTier === "MEDIUM") {
  finalRiskTier = "HIGH"; // demotion for risky schools
}
  
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

// Add this import at the top of valuationEngine.js (if not already there)
import { buildAmortSchedule } from "./loanEngine.js?v=dev";


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
  rate = 0.01; // tiny positive to allow calculations
  monthlyLoanRate = rate / 12;
}

  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  // ── NEW: Incorporate historical events via amort schedule ──
  const amort = buildAmortSchedule(loan);
  const today = new Date();  // Current date: February 04, 2026

  // Find the latest row on or before today
  const currentRow = amort
  .slice()
  .reverse()
  .find(r => r.loanDate <= today);

let currentBalance = currentRow ? Number(currentRow.balance) : originalPrincipal;
if (!Number.isFinite(currentBalance) || currentBalance < 0) currentBalance = 0;

// Remaining months after current row
const currentIndex = amort.indexOf(currentRow);
const remainingMonths = currentIndex >= 0 ? amort.length - currentIndex - 1 : originalTermMonths;
const effectiveRemainingMonths = Math.max(remainingMonths, 1); // at least 1 month to allow calc

if (currentBalance <= 0 || effectiveRemainingMonths <= 0) {

  return {
    loanId: loan.loanId,
    riskTier: deriveRiskTier(borrower),
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
  
  const principal = currentBalance;     // Use seasoned balance
  const termMonths = remainingMonths;   // Use remaining term

  const monthlyPayment = computeMonthlyPayment(principal, rate, termMonths);  // Recalculate for remaining

// -----------------------------
// RISK TIER & CURVE
// -----------------------------
const riskTier = deriveRiskTier(borrower) || "HIGH";

// Get base curve
let curve = VALUATION_CURVES?.riskTiers[riskTier];
if (!curve) {
  console.warn(`No curve for ${riskTier} — fallback HIGH`);
  curve = VALUATION_CURVES?.riskTiers["HIGH"] || {
    riskPremiumBps: 550,
    recovery: { grossRecoveryPct: 20, recoveryLagMonths: 18 },
    defaultCurve: { cumulativeDefaultPct: [0,0,0,0,0,0,0,0,0,0] },
    prepaymentCurve: { valuesPct: [5,5,5,5,5,5,5,5,5,5] }
  };
}
  
// Apply user overrides
const profileAssumptions = profile.assumptions;
const effectiveRiskPremiumBps = profileAssumptions.riskPremiumBps?.[riskTier] ?? curve.riskPremiumBps;
const effectiveRecoveryPct = (profileAssumptions.recoveryRate?.[riskTier] ?? curve.recovery.grossRecoveryPct) / 100;
const effectiveCDRMultiplier = profileAssumptions.cdrMultiplier ?? 1.0;
const effectivePrepayMultiplier = profileAssumptions.prepaymentMultiplier ?? 1.0;

// Now apply multipliers with .map
monthlyPD = monthlyPD.map(pd => pd * effectiveCDRMultiplier);
monthlySMM = monthlySMM.map(smm => smm * effectivePrepayMultiplier);

// School multiplier
const schoolTier = getSchoolTier(borrower.school, borrower.opeid);
const schoolTierLetter = { 'Tier 1': 'A', 'Tier 2': 'B', 'Tier 3': 'C', 'Unknown': 'D' }[schoolTier || 'Unknown'];
const schoolMult = profileAssumptions.schoolTierMultiplier?.[schoolTierLetter] ?? 1.0;
monthlyPD = monthlyPD.map(pd => pd * schoolMult);

// Degree, school, year, grad adjustments
const normalizedDegree = borrower.degreeType === "Professional" ? "Professional" :
                         borrower.degreeType === "Business" ? "Business" :
                         borrower.degreeType === "STEM" ? "STEM" : "Other";
const degreeAdj = profileAssumptions.degreeAdjustmentsBps?.[normalizedDegree] ?? VALUATION_CURVES.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

const schoolAdj = profileAssumptions.schoolAdjustmentsBps?.[schoolTier] ?? getSchoolAdjBps(schoolTier);

const yearKey = borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);
const yearAdj = profileAssumptions.yearInSchoolAdjustmentsBps?.[yearKey] ?? VALUATION_CURVES.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;

const gradAdj = borrower.isGraduateStudent ? (profileAssumptions.graduateAdjustmentBps ?? VALUATION_CURVES.graduateAdjustmentBps ?? 0) : 0;

// Total risk
const totalRiskBps = effectiveRiskPremiumBps + degreeAdj + schoolAdj + yearAdj + gradAdj;

// Cap
const cappedRiskBps = Math.min(totalRiskBps, 500);

// Discount rate
const discountRate = riskFreeRate + cappedRiskBps / 10000;
const monthlyDiscountRate = discountRate / 12;

// Debug
console.log(`Loan ${loan.loanId} effective params:`, {
  riskTier,
  effectiveRiskPremiumBps,
  effectiveRecoveryPct,
  totalRiskBps,
  discountRate: discountRate.toFixed(4)
});
  
  // -----------------------------
  // INTERPOLATE CURVES TO MONTHLY VECTORS (now truncated to remaining term)
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

  let monthlyPD = interpolateCumulativeDefaultsToMonthlyPD(
    curve.defaultCurve.cumulativeDefaultPct,
    termMonths
  );
  let monthlySMM = interpolateAnnualCPRToMonthlySMM(
    curve.prepaymentCurve.valuesPct,
    termMonths
  );

  const recoveryPct = effectiveRecoveryPct;
  const recoveryLag = curve.recovery.recoveryLagMonths;

// -----------------------------
// MONTHLY CASH FLOW LOOP + IRR COLLECTION
// Start from current balance and remaining months
// -----------------------------
let balance = principal;
let npv = 0;
let totalDefaults = 0;
let totalRecoveries = 0;
let walNumerator = 0;
let totalCF = 0;
const cashFlows = [-principal]; // Month 0: current principal as outflow (for IRR consistency)
const recoveryQueue = new Array(termMonths + recoveryLag + 1).fill(0);

// Get inflation rate (monthly compounded)

const monthlyInflation = Math.pow(1 + inflationRate, 1/12) - 1; // ≈ inflation/12

for (let m = 1; m <= termMonths; m++) {
  if (balance <= 0) {
    cashFlows.push(0);
    continue;
  }

  // Inflate the base monthly payment and prepayment behavior with cumulative inflation
  const inflationFactor = Math.pow(1 + monthlyInflation, m); // cumulative from month 1
  const inflatedPayment = monthlyPayment * inflationFactor;
  const inflatedPrepaySMM = monthlySMM[m - 1] * inflationFactor; // optional: scale prepay too

  const interest = balance * monthlyLoanRate;
  const principalPaid = Math.min(inflatedPayment - interest, balance);
  let remaining = balance - principalPaid;

  const prepay = remaining * inflatedPrepaySMM;
  remaining -= prepay;

  const defaultAmt = remaining * monthlyPD[m - 1];
  remaining -= defaultAmt;

  const recMonth = m + recoveryLag;
  if (recMonth < recoveryQueue.length) {
    recoveryQueue[recMonth] += defaultAmt * recoveryPct;
  } else {
    // Late recovery beyond queue — discount directly
    const lateRecovery = defaultAmt * recoveryPct;
    const discounted = lateRecovery / Math.pow(1 + monthlyDiscountRate, recMonth);
    npv += discounted;
    totalRecoveries += lateRecovery;
  }

  const recoveryThisMonth = recoveryQueue[m] || 0;

  // Cash flow: includes inflated payment components + recovery
  const cashFlow = interest + principalPaid + prepay + recoveryThisMonth;

  cashFlows.push(cashFlow);
  const discountedCF = cashFlow / Math.pow(1 + monthlyDiscountRate, m);
  npv += discountedCF;
  walNumerator += discountedCF * m;
  totalCF += discountedCF;
  totalDefaults += defaultAmt;
  totalRecoveries += recoveryThisMonth;

  balance = remaining;
}

  const npvRatio = principal > 0 && Number.isFinite(npv)
    ? (npv / principal) - 1
    : 0;

  // Safe expected loss calculation
  let expectedLoss = 0;
  if (principal > 0 && Number.isFinite(totalDefaults) && Number.isFinite(totalRecoveries)) {
    expectedLoss = (totalDefaults - totalRecoveries) / principal;
  }
  expectedLoss = Number.isFinite(expectedLoss) ? Math.max(0, expectedLoss) : 0; // clamp to >=0

  // Expected loss percentage (same as dollar amount but as fraction)
  const expectedLossPct = expectedLoss; // already a decimal fraction

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
      totalRiskBps,
      schoolTier,
    },
    curve: VALUATION_CURVES?.riskTiers[riskTier] || null
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



//  --------------
// From loanValuation.html file - moving logic out
//  --------------

// ADD TO END OF valuationEngine.js

import { getUserOwnershipPct } from "./ownershipEngine.js?v=dev";  // adjust path if needed
import { getBorrowerById } from "./borrowerStore.js?v=dev";     // adjust path
import { getEffectiveBorrower } from "./valuationOverrides.js?v=dev";  // adjust

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

    const profile = activeProfile === "system" ? SYSTEM_PROFILE : USER_PROFILE;
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



