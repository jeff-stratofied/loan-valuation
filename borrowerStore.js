// borrowerStore.js
export let BORROWERS = [];

export async function loadBorrowers(url) {
  const res = await fetch(url);
  BORROWERS = await res.json();
}

export function getBorrowerById(id) {
  return BORROWERS.find(b => b.borrowerId === id);
}

export function upsertBorrower(borrower) {
  const idx = BORROWERS.findIndex(b => b.borrowerId === borrower.borrowerId);
  if (idx >= 0) BORROWERS[idx] = borrower;
  else BORROWERS.push(borrower);
}
