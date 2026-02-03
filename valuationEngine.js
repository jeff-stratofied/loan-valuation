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

export let SCHOOL_TIERS = null;

export async function loadSchoolTiers(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load school tiers from ${url}`);
  SCHOOL_TIERS = await res.json();
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
  if (!SCHOOL_TIERS) {
    console.warn("SCHOOL_TIERS not loaded – using default Tier 3");
    return "Tier 3";
  }

  // Prefer exact OPEID match (6-digit string) if provided and exists
  if (opeid && SCHOOL_TIERS[opeid.trim()]) {  // trim in case of whitespace
    console.log(`Matched by OPEID: ${opeid} → Tier: ${SCHOOL_TIERS[opeid].tier}`);
    return SCHOOL_TIERS[opeid].tier;
  }

  // Fallback to name match only if no OPEID
  const normalizedName = (schoolName || "").trim().toLowerCase();
  if (normalizedName === "" || normalizedName === "unknown") {
    console.log("Empty/unknown school — default Tier 3");
    return SCHOOL_TIERS.DEFAULT?.tier || "Tier 3";
  }

  for (const entry of Object.values(SCHOOL_TIERS)) {
    if (entry.name && entry.name.toLowerCase() === normalizedName) {
      console.log(`Matched by name: ${schoolName} → ${entry.name} Tier: ${entry.tier}`);
      return entry.tier;
    }
  }

  console.log(`No match for school "${schoolName}" (OPEID: ${opeid || "none"}) — fallback Tier 3`);
  return SCHOOL_TIERS.DEFAULT?.tier || "Tier 3";
}

function getSchoolAdjBps(tier) {
  const adjMap = {
    "Tier 1": -50,   // lower risk → negative adjustment to premium
    "Tier 2":   0,
    "Tier 3":  75    // higher risk → positive adjustment
  };
  return adjMap[tier] || 0;
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
  const principal = Number(loan.principal);
  const rate = Number(loan.rate);
  const termMonths = Number(loan.termYears) * 12;

  if (!principal || !rate || !termMonths) {
    return {
      loanId: loan.loanId,
      riskTier: "UNKNOWN",
      discountRate: null,
      npv: NaN,
      npvRatio: null,
      expectedLoss: NaN,
      wal: NaN
    };
  }

  const monthlyPayment = computeMonthlyPayment(principal, rate, termMonths);
  const monthlyLoanRate = monthlyRate(rate);

  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  // -----------------------------
  // RISK TIER & CURVE
  // -----------------------------
  const riskTier = deriveRiskTier(borrower);
  const curve = VALUATION_CURVES.riskTiers[riskTier];

  // -----------------------------
  // ADDITIVE RISK ADJUSTMENTS
  // -----------------------------
  const normalizedDegree =
    borrower.degreeType === "Professional"
      ? "Professional"
      : borrower.degreeType === "Business"
      ? "Business"
      : borrower.degreeType === "STEM"
      ? "STEM"
      : "Other";

  const degreeAdj = VALUATION_CURVES.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

    // School tier lookup (new real implementation)
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
  const totalRiskBps =
    curve.riskPremiumBps +
    degreeAdj +
    schoolAdj +
    yearAdj +
    gradAdj;

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
    termMonths
  );

  const monthlySMM = interpolateAnnualCPRToMonthlySMM(
    curve.prepaymentCurve.valuesPct,
    termMonths
  );

  const recoveryPct = curve.recovery.grossRecoveryPct / 100;
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

  const recoveryQueue = new Array(termMonths + recoveryLag).fill(0);

  for (let m = 1; m <= termMonths; m++) {
    if (balance <= 0) break;

    const interest = balance * monthlyLoanRate;
    const principalPaid = Math.min(monthlyPayment - interest, balance);
    let remaining = balance - principalPaid;

    const prepay = remaining * monthlySMM[m - 1];
    remaining -= prepay;

    const defaultAmt = remaining * monthlyPD[m - 1];
    remaining -= defaultAmt;

    const recMonth = m + recoveryLag - 1;
    if (recMonth < recoveryQueue.length) {
      recoveryQueue[recMonth] += defaultAmt * recoveryPct;
    } else {
      npv += (defaultAmt * recoveryPct) * discountFactor(discountRate, recMonth + 1);
      totalRecoveries += defaultAmt * recoveryPct;
    }

    const recoveryThisMonth = recoveryQueue[m - 1];
    const cashFlow = interest + principalPaid + prepay + recoveryThisMonth;

    const discountedCF = cashFlow / Math.pow(1 + monthlyDiscountRate, m);  // Equivalent to discountFactor
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

  return {
    loanId: loan.loanId,
    riskTier,
    discountRate,
    npv,
    npvRatio,
    expectedLoss,
    wal,
    riskBreakdown: {
      baseRiskBps: curve.riskPremiumBps,
      degreeAdj,
      schoolAdj,
      yearAdj,
      gradAdj,
      totalRiskBps,
      schoolTier
    }
  };
}

// ================================
// PAYMENT MATH
// ================================

function computeMonthlyPayment(principal, annualRate, months) {
  const r = annualRate / 12;
  return principal * r / (1 - Math.pow(1 + r, -months));
}
