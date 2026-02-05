/*
  valuationEngine.js
  ------------------
  Deterministic loan valuation engine for private student loans.
  Consumes loans.json, borrowers.json, and valuationCurves.json
  to produce loan-level cash flows and NPV.  
*/


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
  if (!SCHOOLTIERS) {
    console.warn("SCHOOLTIERS not loaded – using default Tier 3");
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

// ... (rest of file unchanged)

export function valueLoan({ loan, borrower, riskFreeRate = 0.04 }) {
  // -----------------------------
  // LOAN BASICS
  // -----------------------------
  const originalPrincipal = Number(loan.principal) || 0;
const rate = Number(loan.nominalRate) || 0;
const originalTermMonths = (Number(loan.termYears) || 10) * 12 + (Number(loan.graceYears) || 0) * 12;

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

console.log(`Passed basics check for ${loan.loanId || loan.loanName}`);
  
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

// NOW log — after all variables are declared and assigned
console.log(`Amort length: ${amort.length}, currentBalance: ${currentBalance}, remainingMonths: ${remainingMonths}, effective: ${effectiveRemainingMonths}`);

if (currentBalance <= 0 || effectiveRemainingMonths <= 0) {
  console.log(`Loan ${loan.loanId || loan.loanName} treated as matured/paid-off: balance=${currentBalance}, remainingMonths=${remainingMonths}`);
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

console.log(`Passed maturity check for ${loan.loanId || loan.loanName}`);
  
  const principal = currentBalance;     // Use seasoned balance
  const termMonths = remainingMonths;   // Use remaining term

  const monthlyPayment = computeMonthlyPayment(principal, rate, termMonths);  // Recalculate for remaining

 // -----------------------------
// RISK TIER & CURVE
// -----------------------------
const riskTier = deriveRiskTier(borrower) || "HIGH";  // fallback to HIGH if undefined/UNKNOWN
console.log(`Loan ${loan.loanId || loan.loanName}: computed riskTier = ${riskTier}`);
  
let curve = VALUATION_CURVES?.riskTiers[riskTier];

// Fallback chain if curve is still missing
if (!curve) {
  console.warn(`No curve found for risk tier "${riskTier}" — falling back to HIGH`);
  curve = VALUATION_CURVES?.riskTiers["HIGH"] || {
    riskPremiumBps: 550,           // default HIGH premium
    // Add minimal defaults if needed for other fields your code expects
  };
}

// Now continue with calculations (do NOT return early here unless truly fatal)
  // -----------------------------
  // ADDITIVE RISK ADJUSTMENTS (unchanged)
  // -----------------------------
  const normalizedDegree = borrower.degreeType === "Professional" ? "Professional" :
                           borrower.degreeType === "Business" ? "Business" :
                           borrower.degreeType === "STEM" ? "STEM" : "Other";
  const degreeAdj = VALUATION_CURVES.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;
  const schoolTier = getSchoolTier(borrower.school, borrower.opeid);
  const schoolAdj = getSchoolAdjBps(schoolTier);
  const yearKey = borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);
  const yearAdj = VALUATION_CURVES.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;
  const gradAdj = borrower.isGraduateStudent ? VALUATION_CURVES.graduateAdjustmentBps ?? 0 : 0;

  const totalRiskBps = curve.riskPremiumBps + degreeAdj + schoolAdj + yearAdj + gradAdj;
  const discountRate = riskFreeRate + totalRiskBps / 10000;
  const monthlyDiscountRate = discountRate / 12;

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

  const monthlyPD = interpolateCumulativeDefaultsToMonthlyPD(
    curve.defaultCurve.cumulativeDefaultPct,
    termMonths
  );
  const monthlySMM = interpolateAnnualCPRToMonthlySMM(
    curve.prepaymentCurve.valuesPct,
    termMonths
  );

  const recoveryPct = curve.recovery.grossRecoveryPct / 100;
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

  for (let m = 1; m <= termMonths; m++) {
    if (balance <= 0) {
      cashFlows.push(0);
      continue;
    }

    const interest = balance * monthlyLoanRate;
    const principalPaid = Math.min(monthlyPayment - interest, balance);
    let remaining = balance - principalPaid;

    const prepay = remaining * monthlySMM[m - 1];
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

  const npvRatio = originalPrincipal > 0 && Number.isFinite(npv) ? (npv / originalPrincipal) - 1 : null;
  const expectedLoss = originalPrincipal > 0 ? (totalDefaults - totalRecoveries) / originalPrincipal : 0;
  const wal = totalCF > 0 ? walNumerator / totalCF / 12 : NaN;

console.log(`Cash flows sample for ${loan.loanName}: first 5 =`, cashFlows.slice(0,5), `last 5 =`, cashFlows.slice(-5));
console.log(`Total inflows:`, cashFlows.slice(1).reduce((a,b)=>a+b,0));
  
  const irr = calculateIRR(cashFlows, originalPrincipal);  // Use original principal for IRR consistency

  return {
    loanId: loan.loanId,
    riskTier,
    discountRate,
    npv,
    npvRatio,
    expectedLoss,
    wal,
    irr: Number.isFinite(irr) ? irr : NaN,
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

  let min = -0.5;     // Allow some negative but not crazy
let max = 0.5;      // Cap at 50% monthly (600% annual — way above realistic)
let irr = 0.008;    // ~10% annual monthly guess — better starting point

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
return Number.isFinite(annualIrr) && annualIrr > -100 ? annualIrr : NaN;
}

// In valueLoan(), generate monthly cashFlows array during the loop
// Example: let cashFlows = [0];  // Month 0
// Then in loop: cashFlows.push(cashFlow);  // Each month's CF
// At end: return { ... , irr: calculateIRR(cashFlows, principal) };

// Then in drawer summary: <div>IRR: ${valuation.irr.toFixed(2)}%</div>
