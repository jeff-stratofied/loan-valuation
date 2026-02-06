// worker.js — platform API (loans + platformConfig + loanValuation + Borrowers + schoolTiers)

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

  if (!sha) {
    const getRes = await fetch(url, { headers });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  }

  const body = {
    message,
    content: btoa(content),
    sha
  };

  console.log(`DEBUG: Saving to GitHub - path: ${path}, message: ${message}, sha: ${sha || '(new)'}`);
  console.log(`DEBUG: Content preview (first 500 chars): ${content.substring(0, 500)}...`);

  const putRes = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error(`GitHub PUT failed for ${path}: ${putRes.status} - ${errText}`);
    throw new Error(`GitHub PUT failed: ${putRes.status} - ${errText}`);
  }

  const putData = await putRes.json();
  console.log(`DEBUG: GitHub PUT success - new SHA: ${putData.content.sha}`);

  return noStoreJson({ success: true, sha: putData.content.sha });
}

async function handleFetch(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);

    // ----------------------------------
    // LOANS
    // ----------------------------------
    if (url.pathname === "/loans") {
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(
          env,
          env.GITHUB_FILE_PATH || "data/loans.json"
        );

        return withCORS(
          noStoreJson({ loans: content.loans || content, sha })
        );
      }

if (request.method === "POST") {
  const body = await request.json();

// Log raw incoming body before any processing
  console.log("Worker RAW BODY RECEIVED (stringified preview):", JSON.stringify(body, null, 2).substring(0, 1000) + "...");

  
  console.log("Worker DEBUG: POST /loans received - loan count:", body.loans?.length || 0);
  if (body.loans?.length > 0) {
    const firstLoan = body.loans[0];
    console.log("Worker DEBUG: First loan received - purchaseDate:", firstLoan.purchaseDate || '(missing)');
    console.log("Worker DEBUG: First loan full:", JSON.stringify(firstLoan, null, 2).substring(0, 500) + "...");
  }

const saveContent = JSON.stringify({ loans: body.loans }, null, 2);
  console.log("Worker DEBUG: Content prepared for GitHub - purchaseDate present?", saveContent.includes('"purchaseDate"') ? 'YES' : 'NO');
  
  const saveContent = JSON.stringify({ loans: body.loans }, null, 2);
  console.log("Worker DEBUG: Content prepared for GitHub - purchaseDate preview:", saveContent.includes('"purchaseDate"') ? 'PRESENT' : 'MISSING');

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

    // ----------------------------------
    // BORROWERS (unchanged, but you can add similar logs if needed)
    // ----------------------------------
    if (url.pathname === "/borrowers") {
      const borrowerPath = env.GITHUB_BORROWER_PATH || "data/borrowers.json";

      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, borrowerPath);
        return withCORS(noStoreJson({ borrowers: content, sha }));
      }

      if (request.method === "POST") {
        const body = await request.json();

        if (!body || !Array.isArray(body.borrowers)) {
          return withCORS(
            noStoreJson({ error: "Invalid borrowers body" }, 400)
          );
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

    // ----------------------------------
    // PLATFORM CONFIG (unchanged)
    // ----------------------------------
    if (url.pathname === "/platformConfig") {
      const configPath = env.GITHUB_CONFIG_PATH || "data/platformConfig.json";

      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, configPath);
        return withCORS(noStoreJson({ ...content, sha }));
      }

      if (request.method === "POST") {
        const body = await request.json();

        if (!body || typeof body !== "object" || !body.fees || !body.users) {
          return withCORS(
            noStoreJson({ error: "Invalid config body" }, 400)
          );
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

    // ----------------------------------
    // VALUATION CURVES (read-only for now)
    // ----------------------------------
    if (url.pathname === "/valuationCurves") {
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

    // ----------------------------------
    // SCHOOL TIERS (read-only for now)
    // ----------------------------------
    if (url.pathname === "/schoolTiers") {
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
