// borrowerStore.js

export let BORROWERS = [];

export async function loadBorrowers(url) {
  const res = await fetch(url);
  BORROWERS = await res.json();
}

export function getBorrowerById(borrowerId) {
  return BORROWERS.find(b => b.borrowerId === borrowerId);
}

export function upsertBorrower(borrower) {
  const idx = BORROWERS.findIndex(b => b.borrowerId === borrower.borrowerId);
  if (idx >= 0) BORROWERS[idx] = borrower;
  else BORROWERS.push(borrower);
}

export function ensureBorrowerExists(borrowerId, loanName = "") {
  let b = getBorrowerById(borrowerId);
  if (!b) {
    b = {
      borrowerId,
      borrowerName: loanName || borrowerId,
      borrowerFico: null,
      cosignerFico: null,
      yearInSchool: null,
      isGraduateStudent: false,
      school: "",
      degreeType: "",
      schoolTier: null
    };
    BORROWERS.push(b);
  }
  return b;
}
