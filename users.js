// /loan-valuation/users.js
export let USERS = {};

export async function loadUsers(backendUrl = "https://loan-valuation-api.jeff-263.workers.dev") {
  try {
    const res = await fetch(`${backendUrl}/platformConfig`, { cache: "no-store" });
    if (!res.ok) throw new Error(`platformConfig fetch failed: ${res.status}`);
    const data = await res.json();
    USERS = {};
    (data.users || []).forEach(u => {
      if (u.id && u.active !== false) {
        USERS[u.id] = {
          id: u.id,
          name: u.name || u.id.charAt(0).toUpperCase() + u.id.slice(1),
          role: u.role || 'unknown',
          feeWaiver: u.feeWaiver || 'none'
        };
      }
    });
    console.log(`Loaded ${Object.keys(USERS).length} active users`);
  } catch (err) {
    console.error("Users load failed:", err);
    // Fallback (keep your current 3 users + market)
    USERS = {
      jeff:   { id: "jeff",   name: "Jeff Customer",   role: "customer" },
      nick:   { id: "nick",   name: "Nick Lender",     role: "lender"   },
      john:   { id: "john",   name: "John Investor",   role: "investor" },
      market: { id: "market", name: "Market",          role: "market"   }
    };
  }
}

export function getUserDisplayName(userId) {
  return USERS[userId]?.name || userId || "Unknown User";
}
