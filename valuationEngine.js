/*
  valuationEngine.js
  ------------------
  Deterministic loan valuation engine for private student loans.
  Consumes loans.json, borrowers.json, and valuationCurves.json
  to produce loan-level cash flows and NPV.
*/

import { buildAmortSchedule, getCanonicalCurrentAmortRow } from './loanEngine.js?v=dev';

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

export function valueLoan({ loan, borrower, riskFreeRate }) {
  // -----------------------------
  // LOAN BASICS
  // -----------------------------
  const principalOrig = Number(loan.principal);
  const rate = Number(loan.rate);
  const termYears = Number(loan.termYears);
  const termMonths = termYears * 12;

  if (!principalOrig || !rate || !termMonths || principalOrig <= 0 || rate <= 0 || termMonths <= 0) {
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

  // Check for defaulted loan (exclude from valuation)
  if (loan.events?.some(event => event.type === 'default')) {
    return {
      loanId: loan.loanId,
      riskTier: "DEFAULTED",
      discountRate: null,
      npv: 0,
      npvRatio: -100,
      expectedLoss: 100,
      wal: 0,
      irr: NaN,
      riskBreakdown: { note: "Loan defaulted" }
    };
  }

  // Compute current amortization (includes prepays from events)
  const amort = buildAmortSchedule(loan); // From loanEngine.js
  const principal = amort.currentBalance || principalOrig; // Remaining balance after prepays
  const remainingMonths = amort.schedule.length;

  const monthlyPayment = computeMonthlyPayment(principalOrig, rate, termMonths); // Original payment (for reference)
  const monthlyLoanRate = monthlyRate(rate);

  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  // -----------------------------
  // RISK TIER & CURVE
  // -----------------------------
  const riskTier = deriveRiskTier(borrower);
  const curve = VALUATION_CURVES.riskTiers[riskTier];
  if (!curve) {
    console.warn(`No curve found for risk tier: ${riskTier}`);
    return {
      loanId: loan.loanId,
      riskTier,
      discountRate: null,
      npv: NaN,
      npvRatio: null,
      expectedLoss: NaN,
      wal: NaN,
      irr: NaN
    };
  }

  // -----------------------------
  // ADDITIVE RISK ADJUSTMENTS
  // -----------------------------
  const normalizedDegree =
    borrower.degreeType === "Professional" ? "Professional" :
    borrower.degreeType === "Business" ? "Business" :
    borrower.degreeType === "STEM" ? "STEM" :
    "Other";
  const degreeAdj = VALUATION_CURVES.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

  const schoolTier = getSchoolTier(borrower.school, borrower.opeid);
  const schoolAdj = getSchoolAdjBps(schoolTier);

  const yearKey = borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);
  const yearAdj = VALUATION_CURVES.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;

  const gradAdj = borrower.isGraduateStudent
    ? VALUATION_CURVES.graduateAdjustmentBps ?? 0
    : 0;

  // -----------------------------
  // TOTAL RISK PREMIUM & DISCOUNT RATE
  // -----------------------------
  const totalRiskBps = curve.riskPremiumBps + degreeAdj + schoolAdj + yearAdj + gradAdj;
  const discountRate = riskFreeRate + totalRiskBps / 10000;
  const monthlyDiscountRate = monthlyRate(discountRate);

  // -----------------------------
  // INTERPOLATE CURVES TO MONTHLY VECTORS
  // -----------------------------
  function interpolateCumulativeDefaultsToMonthlyPD(cumDefaultsPct, termMonths) {
    const annualDefaults = cumDefaultsPct.map((cum, i) => (i === 0 ? cum : cum - cumDefaultsPct[i - 1]));
    const monthlyPD = [];
    for (let y = 0; y < annualDefaults.length; y++) {
      const annualPD = annualDefaults[y] / 100;
      const monthly = 1 - Math.pow(1 - annualPD, 1 / 12);
      for (let m = 0; m < 12; m++) {
        monthlyPD.push(monthly);
        if (monthlyPD.length >= termMonths) break;
      }
      if (monthlyPD.length >= termMonths) break;
    }
    while (monthlyPD.length < termMonths) {
      monthlyPD.push(monthlyPD[monthlyPD.length - 1] || 0);
    }
    return monthlyPD;
  }

  function interpolateAnnualCPRToMonthlySMM(annualCPRPct, termMonths) {
    const monthlySMM = [];
    for (let y = 0; y < annualCPRPct.length; y++) {
      const annualCPR = annualCPRPct[y] / 100;
      const smm = 1 - Math.pow(1 - annualCPR, 1 / 12);
      for (let m = 0; m < 12; m++) {
        monthlySMM.push(smm);
        if (monthlySMM.length >= termMonths) break;
      }
      if (monthlySMM.length >= termMonths) break;
    }
    while (monthlySMM.length < termMonths) {
      monthlySMM.push(monthlySMM[monthlySMM.length - 1] || 0);
    }
    return monthlySMM;
  }

  const monthlyPD = interpolateCumulativeDefaultsToMonthlyPD(
    curve.defaultCurve.cumulativeDefaultPct,
    remainingMonths // Use adjusted term after prepays
  );

  const monthlySMM = interpolateAnnualCPRToMonthlySMM(
    curve.prepaymentCurve.valuesPct,
    remainingMonths // Use adjusted term after prepays
  );

  const recoveryPct = curve.recovery.grossRecoveryPct / 100;
  const recoveryLag = curve.recovery.recoveryLagMonths;

  // -----------------------------
  // MONTHLY CASH FLOW LOOP + IRR COLLECTION (using current amort)
  // -----------------------------
  let balance = principal;
  let npv = 0;
  let totalDefaults = 0;
  let totalRecoveries = 0;
  let walNumerator = 0;
  let totalCF = 0;
  const cashFlows = [-principal]; // Month 0: current outflow equivalent
  const recoveryQueue = new Array(remainingMonths + recoveryLag + 1).fill(0);

  for (let m = 1; m <= remainingMonths; m++) {
    if (balance <= 0) {
      cashFlows.push(0);
      continue;
    }

    // Use actual scheduled payment from amort (includes prepay effects)
    const period = amort.schedule[m - 1]; // 0-indexed
    const scheduledPayment = period.principal + period.interest; // Actual payment

    const interest = balance * monthlyLoanRate;
    const principalPaid = Math.min(scheduledPayment - interest, balance);
    let remaining = balance - principalPaid;

    // Apply prepay if any remaining (SMM applied to remaining)
    const prepay = remaining * monthlySMM[m - 1];
    remaining -= prepay;

    // Apply default
    const defaultAmt = remaining * monthlyPD[m - 1];
    remaining -= defaultAmt;

    // Recovery (delayed)
    const recMonth = m + recoveryLag;
    if (recMonth < recoveryQueue.length) {
      recoveryQueue[recMonth] += defaultAmt * recoveryPct;
    } else {
      npv += (defaultAmt * recoveryPct) * discountFactor(discountRate, recMonth + 1);
      totalRecoveries += defaultAmt * recoveryPct;
    }

    const recoveryThisMonth = recoveryQueue[m] || 0;
    const cashFlow = interest + principalPaid + prepay + recoveryThisMonth;
    cashFlows.push(cashFlow); // Store for IRR

    const discountedCF = cashFlow / Math.pow(1 + monthlyDiscountRate, m);
    npv += discountedCF;
    walNumerator += discountedCF * m;
    totalCF += discountedCF;
    totalDefaults += defaultAmt;
    totalRecoveries += recoveryThisMonth;
    balance = remaining;
  }

  const npvRatio = principal > 0 && Number.isFinite(npv) ? (npv / principal) - 1 : null;
  const expectedLoss = principal > 0 ? (totalDefaults - totalRecoveries) / principal : 0;
  const wal = totalCF > 0 ? walNumerator / totalCF / 12 : NaN;

  // Compute IRR (annualized percentage)
  const irr = calculateIRR(cashFlows, principal);

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

  let min = -1.0;
  let max = 1.0;
  let irr = guess;

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

  return irr * 12 * 100; // Best approximation
}

// In valueLoan(), generate monthly cashFlows array during the loop
// Example: let cashFlows = [0];  // Month 0
// Then in loop: cashFlows.push(cashFlow);  // Each month's CF
// At end: return { ... , irr: calculateIRR(cashFlows, principal) };

// Then in drawer summary: <div>IRR: ${valuation.irr.toFixed(2)}%</div>


