// borrowerStore.js

export let BORROWERS = [];

export async function loadBorrowers(url) {
  const res = await fetch(url);
  BORROWERS.length = 0;  // Clear the existing BORROWERS array
  BORROWERS.push(...await res.json());  // Push the new data into the array
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
      degreeType: ""
    };
    BORROWERS.push(b);
  }
  return b;
}
