/*
  valuationEngine.js
  ------------------
  Deterministic loan valuation engine for private student loans.
  Consumes loans.json, borrowers.json, and valuationCurves.json
  to produce loan-level cash flows and NPV.
*/

// ---- Valuation Profiles (Admin page driven) ----

import { getUserOwnershipPct } from "./ownershipEngine";
import { getBorrowerById } from "./borrowerStore";
import { getEffectiveBorrower } from "./valuationOverrides";
import { buildAmortSchedule } from "./loanEngine";

// System defaults (fallback values)
export let SYSTEM_PROFILE = {
  name: "system",
  assumptions: {
    // ── Per-tier objects (no scalar duplicate) ──
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
    // ── Scalar assumptions — defaults match riskValueConfig.json exactly ──
    servicingCostBps:         window.SYSTEM_RISK_CONFIG?.servicingCostBps         ?? 50,
    prepaymentMultiplier:     window.SYSTEM_RISK_CONFIG?.prepaymentMultiplier     ?? 1.0,
    prepaySeasoningYears:     window.SYSTEM_RISK_CONFIG?.prepaySeasoningYears     ?? 2.5,  // unified key (was "prepaySeasoning")
    graduationRateThreshold:  window.SYSTEM_RISK_CONFIG?.graduationRateThreshold  ?? 75,
    earningsThreshold:        window.SYSTEM_RISK_CONFIG?.earningsThreshold        ?? 70000,
    ficoBorrowerAdjustment:   window.SYSTEM_RISK_CONFIG?.ficoBorrowerAdjustment   ?? 75,   // was 50, matches riskValueConfig.json
    ficoCosignerAdjustment:   window.SYSTEM_RISK_CONFIG?.ficoCosignerAdjustment   ?? 25,
    baseRiskFreeRate:         window.SYSTEM_RISK_CONFIG?.baseRiskFreeRate         ?? 4.25,
    cdrMultiplier:            window.SYSTEM_RISK_CONFIG?.cdrMultiplier            ?? 1.0,
    schoolTierMultiplier:     window.SYSTEM_RISK_CONFIG?.schoolTierMultiplier     ?? { A: 0.8, B: 1.0, C: 1.3, D: 1.5 },
    inflationAssumption:      window.SYSTEM_RISK_CONFIG?.inflationAssumption      ?? 3.0,
    // ── Risk tier classification inputs ──
    // These control which borrower factors influence the risk tier assignment itself
    // (separate from how much bps each tier adds to the discount rate).
    tierYearThreshold:        window.SYSTEM_RISK_CONFIG?.tierYearThreshold        ?? 3,    // min year-in-school to unlock better tier for B/A FICO bands
    schoolTierImpact:         window.SYSTEM_RISK_CONFIG?.schoolTierImpact         ?? 1,    // 0=ignore school tier in classification, 1=apply
    cosignerTierBenefit:      window.SYSTEM_RISK_CONFIG?.cosignerTierBenefit      ?? 1,    // 0=ignore cosigner presence, 1=soften tier one step if cosigner present
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

// Standard 5-band FICO classification (industry standard)
// Exceptional: 800–850 → A+
// Very Good:   740–799 → A
// Good:        670–739 → B
// Fair:        580–669 → C
// Poor:        300–579 → D
export function deriveFicoBand(fico) {
  if (fico == null) return "UNKNOWN";
  if (fico >= 800) return "A+";   // Exceptional
  if (fico >= 740) return "A";    // Very Good
  if (fico >= 670) return "B";    // Good
  if (fico >= 580) return "C";    // Fair
  return "D";                     // Poor
}

// Returns bps adjustment relative to 700 (neutral baseline).
// Negative = lower spread (better credit), Positive = higher spread (worse credit).
// ficoBorrowerAdjustment / ficoCosignerAdjustment from drawer = max swing per full band step.
export function computeFicoAdjBps(borrowerFico, cosignerFico, assumptions) {
  const borrowerAdj = assumptions.ficoBorrowerAdjustment ?? 75;  // bps per band step
  const cosignerAdj = assumptions.ficoCosignerAdjustment ?? 25;

  // Band → signed multiplier (steps from neutral "B/Good" baseline)
  // A+ = –2 steps, A = –1 step, B = 0 (neutral), C = +1 step, D = +2 steps
  const bandStep = { "A+": -2, "A": -1, "B": 0, "C": +1, "D": +2, "UNKNOWN": +1 };

  const bBand = deriveFicoBand(borrowerFico);
  const cBand = deriveFicoBand(cosignerFico);

  const bAdj = borrowerFico != null ? bandStep[bBand] * borrowerAdj : 0;
  const cAdj = cosignerFico != null ? bandStep[cBand] * cosignerAdj : 0;

  return bAdj + cAdj;
}

function computeSchoolTier(schoolData, assumptions) {
  // grad_rate in schoolTiers.json is a decimal (0.93 = 93%).
  // graduationRateThreshold is a whole number (75 = 75%). Normalise to same scale.
  const grad = (schoolData.grad_rate || 0) * 100;
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
    console.debug("SCHOOLTIERS not ready yet – using default Tier 3");
    return "Tier 3";
  }

  let schoolData;

  // 1. Prefer OPEID direct lookup
  if (opeid && opeid !== "MISSING") {
    schoolData = SCHOOLTIERS[opeid.trim()];
  }

  // 2. No OPEID (or unrecognised) — try name_aliases then canonical name match
  if (!schoolData && schoolName && schoolName.trim()) {
    const name    = schoolName.trim();
    const aliases = SCHOOLTIERS._metadata?.name_aliases ?? {};

    // 2a. Exact alias match (handles "Pitt", "NYU", allcaps variants, etc.)
    if (aliases[name]) {
      schoolData = SCHOOLTIERS[aliases[name]];
    }

    // 2b. Case-insensitive alias match
    if (!schoolData) {
      const nameLower = name.toLowerCase();
      const aliasKey  = Object.keys(aliases).find(k => k.toLowerCase() === nameLower);
      if (aliasKey) schoolData = SCHOOLTIERS[aliases[aliasKey]];
    }

    // 2c. Case-insensitive match against canonical school names in the file
    if (!schoolData) {
      const nameLower = name.toLowerCase();
      const entry = Object.entries(SCHOOLTIERS).find(([k, v]) =>
        !k.startsWith("_") && k !== "DEFAULT" &&
        typeof v === "object" && v.name?.toLowerCase() === nameLower
      );
      if (entry) schoolData = entry[1];
    }
  }

  // 3. Hard default
  if (!schoolData) {
    console.warn(`School not resolved — name="${schoolName}" opeid="${opeid}" — using DEFAULT Tier 3`);
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


// Base school adjustment bps at multiplier = 1.0 (neutral).
// These are the anchors — the schoolTierMultiplier in assumptions scales them up or down.
// Tier 1 (elite) reduces spread; Tier 3 (low completion/earnings) adds risk premium.
const SCHOOL_BASE_BPS = {
  "Tier 1": -75,    // elite — lowers PD, rewards strong graduation + earnings outcomes
  "Tier 2":   0,    // average — neutral anchor; multiplier has no effect here by design
  "Tier 3": +125,   // weak outcomes — penalises low completion / low earnings
  "Unknown": +100   // conservative default when school data is missing
};

// Maps Tier 1/2/3/Unknown → the A/B/C/D keys used in schoolTierMultiplier
const TIER_TO_MULTIPLIER_KEY = {
  "Tier 1": "A",
  "Tier 2": "B",
  "Tier 3": "C",
  "Unknown": "D"
};

// Applies the user-adjustable schoolTierMultiplier to the base bps.
// At system defaults (A:0.8, B:1.0, C:1.3, D:1.5) this produces:
//   Tier 1 → -75 × 0.8 = -60 bps   (elite discount, modestly conservative)
//   Tier 2 →   0 × 1.0 =   0 bps   (neutral, always)
//   Tier 3 → 125 × 1.3 = +163 bps  (meaningful penalty for weak schools)
//   Unknown→ 100 × 1.5 = +150 bps  (maximum conservatism for missing data)
function computeSchoolAdjBps(tier, assumptions) {
  const base = SCHOOL_BASE_BPS[tier] ?? SCHOOL_BASE_BPS["Unknown"];
  const multiplierMap = assumptions.schoolTierMultiplier ?? { A: 0.8, B: 1.0, C: 1.3, D: 1.5 };
  const key = TIER_TO_MULTIPLIER_KEY[tier] ?? "D";
  const multiplier = multiplierMap[key] ?? 1.0;
  return Math.round(base * multiplier);
}



// ── Risk tier weights (must sum to 1.0) ──
// Weights reflect relative importance of each factor as a default predictor.
// FICO uses absolute score (not band) to preserve within-band differentiation.
const TIER_WEIGHTS = {
  fico:     0.65,  // 65% — absolute credit score is the primary default predictor
  year:     0.15,  // 15% — time in school / repayment status proxies near-term risk
  school:   0.10,  // 10% — institution quality affects graduation odds and earnings capacity
  cosigner: 0.10,  // 10% — cosigner presence provides a contractual backstop
};

// Per-factor raw scores: 0.0 = lowest risk, 1.0 = highest risk.
// FICO uses a continuous scale across the practical lending range (580–850).
// Year uses non-linear steps: None/grad = in repayment (lowest risk), Year 1 = highest.
const YEAR_SCORE_MAP  = { grad: 0.0, none: 0.0, 5: 0.10, 4: 0.20, 3: 0.40, 2: 0.70, 1: 1.00 };
const SCHOOL_SCORE_MAP = { "Tier 1": 0.00, "Tier 2": 0.40, "Unknown": 0.70, "Tier 3": 1.00 };

const FICO_SCORE_MIN = 580;   // D-band floor — scores at or below map to 1.0
const FICO_SCORE_MAX = 850;   // Perfect FICO — maps to 0.0
const FICO_SCORE_MISSING = 0.85;  // Conservative default for unknown FICO

// Composite score thresholds (calibrated to this portfolio's 0.17–0.63 range)
// Thresholds calibrated to the full resolved portfolio (score range 0.14–0.63).
// Weights: FICO 65%, year 15%, school 10%, cosigner 10%.
// Year weight reduced from 20%→15% so strong-FICO borrowers (760+ with cosigner
// at Tier 1 school) are not pushed out of LOW by being early in school.
const TIER_THRESHOLDS = [
  { max: 0.33, tier: "LOW"       },
  { max: 0.46, tier: "MEDIUM"    },
  { max: 0.63, tier: "HIGH"      },
  { max: 1.00, tier: "VERY_HIGH" },
];

export function deriveRiskTier(borrower = {}, assumptions = SYSTEM_PROFILE.assumptions) {
  const {
    borrowerFico  = null,
    cosignerFico  = null,
    yearInSchool  = null,
    isGraduateStudent = false,
    school        = "",
    opeid         = null,
  } = borrower;

  // ── Pull assumption controls ──
  const yearThreshold   = assumptions.tierYearThreshold   ?? 3;
  const schoolImpact    = assumptions.schoolTierImpact    ?? 1;
  const cosignerBenefit = assumptions.cosignerTierBenefit ?? 1;

  // ── 1. FICO score (60%) ──
  // Absolute score across 580–850 range. Preserves within-band differentiation —
  // a 670 and a 730 are both band B but score differently here.
  const ficoRaw = borrowerFico == null
    ? FICO_SCORE_MISSING
    : Math.max(0.0, Math.min(1.0, (FICO_SCORE_MAX - borrowerFico) / (FICO_SCORE_MAX - FICO_SCORE_MIN)));

  // ── 2. Year-in-school score (20%) ──
  // None = in repayment = lowest risk (0.0). Year 1 = highest risk (1.0).
  // Threshold is user-adjustable: years below it are penalised proportionally.
  let yearRaw = 0.0;
  if (!isGraduateStudent && yearInSchool != null) {
    const y = typeof yearInSchool === "string"
      ? ({ A:6,B:7,C:8,D:9,Z:null }[yearInSchool.toUpperCase()] ?? parseInt(yearInSchool))
      : Number(yearInSchool);
    if (y != null && !isNaN(y)) {
      yearRaw = y >= yearThreshold
        ? YEAR_SCORE_MAP[y] ?? 0.10
        : Math.min(1.0, YEAR_SCORE_MAP[Math.min(y, 5)] ?? 0.50);
    }
  }

  // ── 3. School tier score (10%) ──
  // When disabled (schoolTierImpact=0), treated as Tier 2 neutral (0.40).
  const schoolTier = getSchoolTier(school, opeid, assumptions);
  const schoolRaw  = schoolImpact >= 1
    ? (SCHOOL_SCORE_MAP[schoolTier] ?? 0.70)
    : 0.40;

  // ── 4. Cosigner score (10%) ──
  // Present = 0.0 (best); absent = 1.0 (worst).
  // When disabled (cosignerTierBenefit=0), treated as neutral (0.50).
  const cosignerRaw = cosignerBenefit >= 1
    ? ((cosignerFico != null && cosignerFico > 0) ? 0.0 : 1.0)
    : 0.50;

  // ── Weighted composite → tier ──
  const composite = (
    TIER_WEIGHTS.fico     * ficoRaw     +
    TIER_WEIGHTS.year     * yearRaw     +
    TIER_WEIGHTS.school   * schoolRaw   +
    TIER_WEIGHTS.cosigner * cosignerRaw
  );

  const entry = TIER_THRESHOLDS.find(e => composite < e.max) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
  return entry.tier;
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
  // FICO adjustment — signed bps relative to neutral baseline (Good / ~700).
  // Exceptional (800+) → negative bps (reduces spread), Poor (<580) → positive bps (widens spread).
  const ficoAdj = computeFicoAdjBps(borrower.borrowerFico, borrower.cosignerFico, profile.assumptions);

  // Degree adjustment
  const normalizedDegree =
    borrower.degreeType === "STEM" ? "STEM" :
    borrower.degreeType === "Business" ? "BUSINESS" :
    borrower.degreeType === "Liberal Arts" ? "LIBERAL_ARTS" :
    borrower.degreeType === "Professional (e.g. Nursing, Law)" ? "PROFESSIONAL" :
    borrower.degreeType === "Other" ? "OTHER" :
    "UNKNOWN";

  const degreeAdj = profile.assumptions.degreeAdjustmentsBps?.[normalizedDegree] ?? 0;

  // School tier + adjustment (multiplier-aware — schoolTierMultiplier from assumptions is now live)
  const schoolTier = getSchoolTier(borrower.school, borrower.opeid, profile.assumptions);
  const schoolAdj = profile.assumptions.schoolAdjustmentsBps?.[schoolTier]
    ?? computeSchoolAdjBps(schoolTier, profile.assumptions);

  // Year-in-school + graduate adjustments
  const yearKey = borrower.yearInSchool >= 5 ? "5+" : String(borrower.yearInSchool);
  const yearAdj = profile.assumptions.yearInSchoolAdjustmentsBps?.[yearKey] ?? 0;
  const gradAdj = borrower.isGraduateStudent ? (profile.assumptions.graduateAdjustmentBps ?? 0) : 0;

  // TOTAL RISK BPS (now includes FICO, degree, school, etc.)
  // Cap applies only to the adjustment stack — never truncates the base tier premium itself.
  // This prevents HIGH (550 bps) and VERY_HIGH (750 bps) from being silently compressed
  // below their own baseline before any adjustments are even applied.
  const totalAdjBps = degreeAdj + schoolAdj + yearAdj + gradAdj + ficoAdj;
  const cappedAdjBps = Math.max(-400, Math.min(totalAdjBps, 400)); // ±400 bps max swing
  const totalRiskBps = userRiskBps + cappedAdjBps;

  // Override base risk-free rate from user profile
  const effectiveRiskFreeRate = (profile.assumptions.baseRiskFreeRate ?? riskFreeRate * 100) / 100;
  const discountRate = effectiveRiskFreeRate + totalRiskBps / 10000;
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

// Ramp up to full multiplier after seasoning; 10% of normal rate before seasoning completes
const effectiveMultiplier = (m >= seasoningMonths) ? multiplier : multiplier * 0.1;
const adjustedSMM = baseSMM * effectiveMultiplier;
const prepay = remainingAfterScheduled * adjustedSMM;


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
      totalAdjBps,      // raw sum of all adjustments before cap
      cappedAdjBps,     // after ±400 bps cap
      totalRiskBps,     // base + cappedAdj — what actually feeds discountRate
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