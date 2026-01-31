// loadLoans.js

const API_URL = "https://loanreporting-api.jeff-263.workers.dev/loans";

// ===============================
// LOAD loans (API fetch only)
// ===============================
export async function loadLoans() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });

    if (!res.ok) {
      console.error("Fetch failed:", res.status, res.statusText);
      return { loans: [], sha: null };
    }

    const data = await res.json();

    if (Array.isArray(data.loans)) {
      return data; // { loans, sha }
    }

    console.warn("Unexpected API shape:", data);
    return { loans: [], sha: null };

  } catch (err) {
    console.error("API error:", err);
    return { loans: [], sha: null };
  }
}

// ----------------------------------------------------
// SAVE loans  (POST { loans, sha })
// ----------------------------------------------------
export async function saveLoans(loans, sha) {
  const payload = { loans };
  if (sha) payload.sha = sha;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Save API Error:", res.status, text);
    throw new Error(`Save error: ${res.status}`);
  }

  return await res.json(); // includes content.sha
}
