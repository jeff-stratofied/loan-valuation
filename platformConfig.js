// ===================================================
// Platform Config (single source of truth)
// ===================================================

export let PLATFORM_CONFIG = {
  fees: {
    setupFee: 150,
    monthlyServicingBps: 25
  },
  users: {}
};

// ----------------------------------
// Load platform config from GitHub
// ----------------------------------
export async function loadPlatformConfig() {
  const res = await fetch("/api/platform-config", {
    cache: "no-store"
  });

Object.freeze(PLATFORM_CONFIG.fees);
  
  if (!res.ok) {
    throw new Error(`Failed to load platform config: ${res.status}`);
  }

  const cfg = await res.json();

  PLATFORM_CONFIG.fees = cfg.fees || PLATFORM_CONFIG.fees;
  PLATFORM_CONFIG.users = cfg.users || {};
}

// ----------------------------------
// Save platform config back to GitHub
// (ADMIN ONLY)
// ----------------------------------
export async function savePlatformConfig() {
  if (!window.saveToBackend) {
    console.warn("saveToBackend not available (read-only page)");
    return;
  }

  return window.saveToBackend(
    "platformConfig.json",
    JSON.stringify(PLATFORM_CONFIG, null, 2),
    "Update platform config"
  );
}
