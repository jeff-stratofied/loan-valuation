// valuationOverrides.js

// This map will hold loan-specific overrides, keyed by loanId
export const VALUATION_OVERRIDES = new Map();

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
