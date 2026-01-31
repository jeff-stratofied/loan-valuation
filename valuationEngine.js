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
  if (!VALUATION_CURVES) throw new Error("Valuation curves not loaded");

  const riskTier = deriveRiskTier(borrower);
  const curve = VALUATION_CURVES.riskTiers[riskTier];

  const termMonths = loan.termYears * 12;
  const rate = loan.rate;
  const monthlyPayment = computeMonthlyPayment(
    loan.principal,
    rate,
    termMonths
  );

let balance = Number(loan.principal);
let npv = 0;

const principal = Number(loan.principal);
const discountRate = riskFreeRate + curve.riskPremiumBps / 10000;

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
  npvRatio
};
}

// ================================
// PAYMENT MATH
// ================================

function computeMonthlyPayment(principal, annualRate, months) {
  const r = annualRate / 12;
  return principal * r / (1 - Math.pow(1 + r, -months));
}
