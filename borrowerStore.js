let BORROWERS = [];

/* ===============================
   LOAD / SAVE
================================ */

export async function loadBorrowers(url) {
  const res = await fetch(url);
  BORROWERS = await res.json();
  return BORROWERS;
}

export function getBorrowers() {
  return BORROWERS;
}

export function getBorrowerById(borrowerId) {
  return BORROWERS.find(b => b.borrowerId === borrowerId);
}

export function upsertBorrower(borrower) {
  const idx = BORROWERS.findIndex(b => b.borrowerId === borrower.borrowerId);
  if (idx >= 0) {
    BORROWERS[idx] = borrower;
  } else {
    BORROWERS.push(borrower);
  }
}

/* ===============================
   DEFAULT / FACTORY
================================ */

export function createEmptyBorrower(borrowerId) {
  return {
    borrowerId,
    borrowerFico: null,
    yearInCollege: 1,
    isGraduateStudent: false,
    degreeType: "Other",
    cosigner: {
      exists: false,
      fico: null
    }
  };
}
