// users.js — export for all pages to import
export let USERS = {};  // Runtime populated

export async function loadUsers(backendUrl = "https://loan-valuation-api.jeff-263.workers.dev") {
  try {
    const res = await fetch(`${backendUrl}/platformConfig`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load platformConfig");
    const data = await res.json();
    USERS = {};
    (data.users || []).forEach(u => {
      if (u.id && u.active) {
        USERS[u.id] = { id: u.id, name: u.name, role: u.role, feeWaiver: u.feeWaiver };
      }
    });
    console.log(`Loaded ${Object.keys(USERS).length} active users`);
  } catch (err) {
    console.error("Users load failed:", err);
    // Fallback hardcoded (for offline/dev)
    USERS = {
      jeff: { id: "jeff", name: "Jeff Customer", role: "customer", feeWaiver: "all" },
      nick: { id: "nick", name: "Nick Lender", role: "lender", feeWaiver: "setup" },
      john: { id: "john", name: "John Investor", role: "investor", feeWaiver: "none" },
      market: { id: "market", name: "Market", role: "market", feeWaiver: "none" }
    };
  }
}

// Helper: Get fee waiver for user
export function getUserFeeWaiver(userId) {
  return USERS[userId]?.feeWaiver || "none";
}
