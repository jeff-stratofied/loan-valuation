function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://jeff-stratofied.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function withCORS(res) {
  const headers = new Headers(res.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) =>
    headers.set(k, v)
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

function noStoreJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    }
  });
}

const GITHUB_API_BASE = `https://api.github.com/repos`;

async function loadFromGitHub(env, path) {
  const url = `${GITHUB_API_BASE}/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "User-Agent": "Cloudflare-Worker",
      Accept: "application/vnd.github.v3+json"
    },
    cache: "no-store"
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub GET failed for ${path}: ${res.status} - ${errText}`);
  }
  const data = await res.json();
  return {
    content: JSON.parse(atob(data.content)),
    sha: data.sha
  };
}

async function saveJsonToGitHub(env, { path, content, message, sha }) {
  const url = `${GITHUB_API_BASE}/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    "User-Agent": "Cloudflare-Worker",
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json"
  };
  // Always fetch the latest SHA to avoid stale conflicts
  console.log(`DEBUG SAVE: Fetching latest SHA for ${path}`);
  const getRes = await fetch(url, { headers });
  if (!getRes.ok) {
    const errText = await getRes.text();
    console.error(`Failed to get latest SHA: ${getRes.status} - ${errText}`);
    throw new Error(`Failed to get latest SHA`);
  }
  const data = await getRes.json();
  const latestSha = data.sha;
  console.log(`DEBUG SAVE: Latest SHA fetched: ${latestSha}`);
  const body = {
    message,
    content: btoa(content),
    sha: latestSha,
    branch: "main" // CHANGE TO YOUR ACTUAL BRANCH NAME
  };
  console.log(`DEBUG SAVE: Attempting PUT with fresh SHA: ${latestSha}, branch: main`);
  let putRes = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  });
  // Retry on any failure
  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error(`GitHub PUT failed: ${putRes.status} - ${errText}`);
    console.log("DEBUG SAVE: Retrying with re-fetched SHA");
    const retryGet = await fetch(url, { headers });
    if (retryGet.ok) {
      const retryData = await retryGet.json();
      body.sha = retryData.sha;
      console.log(`DEBUG SAVE: Retry with new sha: ${body.sha}`);
      const retryPut = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });
      if (!retryPut.ok) {
        const retryErr = await retryPut.text();
        throw new Error(`Retry failed: ${retryPut.status} - ${retryErr}`);
      }
      const retryResponse = await retryPut.json();
      console.log(`DEBUG SAVE: Retry success - new SHA: ${retryResponse.content.sha}`);
      return noStoreJson({ success: true, sha: retryResponse.content.sha });
    }
  }
  const putData = await putRes.json();
  console.log(`DEBUG SAVE: GitHub PUT success - new SHA: ${putData.content.sha}`);
  return noStoreJson({ success: true, sha: putData.content.sha });
}

async function handleFetch(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // ────────────────────────────────────────────────
    // CONFIG ENDPOINT (new - for risk/value controls)
    // ────────────────────────────────────────────────
    if (path === "/config") {
      if (request.method === "GET") {
        const storedConfig = await env.CONFIG.get("risk-value-config");
        let config;
        if (storedConfig) {
          config = JSON.parse(storedConfig);
          console.log("Loaded config from KV:", config);
        } else {
          // Return defaults if no stored config
          config = {
            riskPremiumBps: { LOW: 250, MEDIUM: 350, HIGH: 550, VERY_HIGH: 750 },
            recoveryRate: { LOW: 30, MEDIUM: 22, HIGH: 15, VERY_HIGH: 10 },
            prepaymentMultiplier: 1.0,
            graduationRateThreshold: 75,
            earningsThreshold: 70000,
            ficoBorrowerAdjustment: 50,
            ficoCosignerAdjustment: 25,
            baseRiskFreeRate: 4.25,
            cdrMultiplier: 1.0,
            prepaySeasoning: 2.5,
            schoolTierMultiplier: { A: 0.8, B: 1.0, C: 1.3, D: 1.5 },
            inflationAssumption: 3.0
          };
          console.log("No stored config - returning defaults");
        }
        return withCORS(noStoreJson(config));
      }

      if (request.method === "POST") {
        const body = await request.json();
        await env.CONFIG.put("risk-value-config", JSON.stringify(body));
        console.log("Saved new config to KV:", body);
        return withCORS(new Response("Config saved", { status: 200 }));
      }

      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // ────────────────────────────────────────────────
    // LOANS (unchanged)
    // ────────────────────────────────────────────────
    if (path === "/loans") {
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(
          env,
          env.GITHUB_FILE_PATH || "data/loans.json"
        );
        return withCORS(noStoreJson({ loans: content.loans || content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        // Your existing logging...
        console.log("Worker RAW BODY RECEIVED (stringified preview):", JSON.stringify(body, null, 2).substring(0, 1000) + "...");
        console.log("Worker DEBUG: POST /loans received - loan count:", body.loans?.length || 0);
        if (body.loans?.length > 0) {
          const firstLoan = body.loans[0];
          console.log("Worker DEBUG: First loan received - purchaseDate:", firstLoan.purchaseDate || '(missing)');
          console.log("Worker DEBUG: First loan full:", JSON.stringify(firstLoan, null, 2).substring(0, 500) + "...");
        }
        const saveContent = JSON.stringify({ loans: body.loans }, null, 2);
        console.log("Worker DEBUG: Content prepared for GitHub - purchaseDate present?",
          saveContent.includes('"purchaseDate"') ? 'YES' : 'NO'
        );
        return withCORS(
          await saveJsonToGitHub(env, {
            path: env.GITHUB_FILE_PATH || "data/loans.json",
            content: saveContent,
            message: "Update loans via admin",
            sha: body.sha
          })
        );
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // ────────────────────────────────────────────────
    // BORROWERS (unchanged)
    // ────────────────────────────────────────────────
    if (path === "/borrowers") {
      const borrowerPath = env.GITHUB_BORROWER_PATH || "data/borrowers.json";
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, borrowerPath);
        return withCORS(noStoreJson({ borrowers: content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        if (!body || !Array.isArray(body.borrowers)) {
          return withCORS(noStoreJson({ error: "Invalid borrowers body" }, 400));
        }
        return withCORS(
          await saveJsonToGitHub(env, {
            path: borrowerPath,
            content: JSON.stringify(body.borrowers, null, 2),
            message: "Update borrowers via admin",
            sha: body.sha
          })
        );
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // ────────────────────────────────────────────────
    // PLATFORM CONFIG (unchanged)
    // ────────────────────────────────────────────────
    if (path === "/platformConfig") {
      const configPath = env.GITHUB_CONFIG_PATH || "data/platformConfig.json";
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, configPath);
        return withCORS(noStoreJson({ ...content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        if (!body || typeof body !== "object" || !body.fees || !body.users) {
          return withCORS(noStoreJson({ error: "Invalid config body" }, 400));
        }
        return withCORS(
          await saveJsonToGitHub(env, {
            path: configPath,
            content: JSON.stringify(body, null, 2),
            message: "Update platform config via admin"
          })
        );
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // ────────────────────────────────────────────────
    // VALUATION CURVES (unchanged)
    // ────────────────────────────────────────────────
    if (path === "/valuationCurves") {
      if (request.method === "GET") {
        const curvesPath = env.GITHUB_VALUATION_CURVES_PATH || "data/valuationCurves.json";
        try {
          const { content, sha } = await loadFromGitHub(env, curvesPath);
          return withCORS(noStoreJson({ ...content, sha }));
        } catch (err) {
          console.error("Failed to load valuationCurves.json from GitHub:", err);
          return withCORS(noStoreJson({ error: "Failed to load valuation curves", details: err.message }, 500));
        }
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // ────────────────────────────────────────────────
    // SCHOOL TIERS (unchanged)
    // ────────────────────────────────────────────────
    if (path === "/schoolTiers") {
      if (request.method === "GET") {
        const tiersPath = env.GITHUB_SCHOOLTIERS_PATH || "data/schoolTiers.json";
        try {
          const { content, sha } = await loadFromGitHub(env, tiersPath);
          return withCORS(noStoreJson({ ...content, sha }));
        } catch (err) {
          console.error("Failed to load schoolTiers.json from GitHub:", err);
          return withCORS(noStoreJson({ error: "Failed to load school tiers", details: err.message }, 500));
        }
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    return withCORS(new Response("Not found", { status: 404 }));
  } catch (err) {
    console.error("Worker error:", err);
    return withCORS(
      noStoreJson(
        { error: err.message, stack: err.stack || "N/A" },
        500
      )
    );
  }
}

export default { fetch: handleFetch };
