// valuationOverrides.js

// This map will hold loan-specific overrides, keyed by loanId
const STORAGE_KEY = "loanValuationOverrides";

function persistOverrides() {
  const obj = Object.fromEntries(VALUATION_OVERRIDES.entries());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}


export const VALUATION_OVERRIDES = new Map();


export function setOverride(loanId, partial) {
  const existing = VALUATION_OVERRIDES.get(loanId) || {};
  const updated = { ...existing, ...partial };

  VALUATION_OVERRIDES.set(loanId, updated);
  persistOverrides();
}


/**
 * Function to get the effective borrower, applying overrides if they exist.
 * @param {Object} loan - The loan object.
 * @param {Object} systemBorrower - The system (admin) borrower object.
 * @returns {Object} - The effective borrower, combining system data and overrides.
 */
export function getEffectiveBorrower({ loan, systemBorrower }) {
  // Get the override data for the loan, if any
  const override = VALUATION_OVERRIDES.get(loan.loanId);

  // Return the system borrower merged with overrides
  return override ? { ...systemBorrower, ...override } : systemBorrower;
}

/**
 * Function to set or update an override for a specific loan.
 * @param {string} loanId - The unique ID for the loan.
 * @param {Object} patch - The changes to apply to the loan's borrower.
 */
export function setOverride(loanId, patch) {
  const current = VALUATION_OVERRIDES.get(loanId) || {};
  VALUATION_OVERRIDES.set(loanId, { ...current, ...patch });
}

export function loadOverrides() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([loanId, override]) => {
      VALUATION_OVERRIDES.set(loanId, override);
    });
  } catch (e) {
    console.warn("Failed to load valuation overrides", e);
  }
}


