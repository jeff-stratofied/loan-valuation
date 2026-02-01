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

function deriveSchoolTier(school) {
  if (!school) return "Unknown";

  // Placeholder mapping – safe defaults
  const TIER1 = ["MIT", "Stanford", "Harvard", "Princeton"];
  const TIER2 = ["Penn State", "UCLA", "Michigan"];

  if (TIER1.includes(school)) return "Tier1";
  if (TIER2.includes(school)) return "Tier2";
  return "Tier3";
}


export function deriveRiskTier({ borrowerFico, cosignerFico, yearInSchool, isGraduateStudent }) {
  const fico = Math.max(borrowerFico || 0, cosignerFico || 0);
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
      npvRatio: null
    };
  }

  const monthlyPayment = computeMonthlyPayment(
    principal,
    rate,
    termMonths
  );

  let balance = principal;
  let npv = 0;

  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  const riskTier = deriveRiskTier(borrower);
const curve = VALUATION_CURVES.riskTiers[riskTier];

// -----------------------------
// ADDITIVE RISK ADJUSTMENTS
// -----------------------------

// Normalize degree type to match valuationCurves keys
const normalizedDegree =
  borrower.degreeType === "Professional"
    ? "Professional"
    : borrower.degreeType === "Business"
    ? "Business"
    : borrower.degreeType === "STEM"
    ? "STEM"
    : "Other";

  
const degreeAdj =
  VALUATION_CURVES.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

  console.log("Degree pricing:", {
  raw: borrower.degreeType,
  normalized: normalizedDegree,
  degreeAdj
});

const schoolTier = deriveSchoolTier(borrower.school);
const schoolAdj =
  VALUATION_CURVES.schoolTierAdjustmentsBps?.[schoolTier] ?? 0;

const yearKey =
  borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);

const yearAdj =
  VALUATION_CURVES.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;

const gradAdj =
  borrower.isGraduateStudent
    ? VALUATION_CURVES.graduateAdjustmentBps ?? 0
    : 0;

// -----------------------------
// TOTAL RISK + DISCOUNT RATE
// -----------------------------

const totalRiskBps =
  curve.riskPremiumBps +
  degreeAdj +
  schoolAdj +
  yearAdj +
  gradAdj;

const discountRate = riskFreeRate + totalRiskBps / 10000;

for (let m = 1; m <= termMonths; m++) {
  const interest = balance * monthlyRate(rate);
  const principalPaid = Math.min(monthlyPayment - interest, balance);
  balance -= principalPaid;

  const cashFlow = interest + principalPaid;

  npv += cashFlow * discountFactor(discountRate, m);

  if (balance <= 0) break;
}

// 🔑 ADD THIS
const npvRatio =
  principal > 0 && Number.isFinite(npv)
    ? (npv / principal) - 1
    : null;

return {
  loanId: loan.loanId,
  riskTier,
  discountRate,
  npv,
  npvRatio,
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
