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
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
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

// Load file from GitHub
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

// Save JSON to GitHub (single reliable version)
async function saveToGitHub(env, path, content, oldSha, commitMsg) {
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const apiUrl = `${GITHUB_API_BASE}/${repo}/contents/${path}`;

  // Fetch latest SHA to avoid conflicts
  const getRes = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "User-Agent": "Cloudflare-Worker",
      Accept: "application/vnd.github.v3+json"
    }
  });

  let latestSha = oldSha;
  if (getRes.ok) {
    const getData = await getRes.json();
    latestSha = getData.sha;
  }

  const payload = {
    message: commitMsg || "Update via admin",
    content: btoa(unescape(encodeURIComponent(content))),
    sha: latestSha,
    branch: env.GITHUB_BRANCH || "main"
  };

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "User-Agent": "Cloudflare-Worker",
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json"
    },
    body: JSON.stringify(payload)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub PUT failed: ${putRes.status} - ${errText}`);
  }

  const putData = await putRes.json();
  return putData.content.sha;
}

async function handleFetch(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);

    // LOANS
    if (url.pathname === "/loans") {
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, env.GITHUB_FILE_PATH || "data/loans.json");
        return withCORS(noStoreJson({ loans: content.loans || content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        const saveContent = JSON.stringify({ loans: body.loans }, null, 2);
        const newSha = await saveToGitHub(
          env,
          env.GITHUB_FILE_PATH || "data/loans.json",
          saveContent,
          body.sha,
          "Update loans via admin"
        );
        return withCORS(noStoreJson({ success: true, sha: newSha }));
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // PLATFORM CONFIG
    if (url.pathname === "/platformConfig") {
      const configPath = env.GITHUB_CONFIG_PATH || "data/platformConfig.json";
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, configPath);
        return withCORS(noStoreJson({ ...content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        const newSha = await saveToGitHub(
          env,
          configPath,
          JSON.stringify(body, null, 2),
          body.sha,
          "Update platform config via admin"
        );
        return withCORS(noStoreJson({ success: true, sha: newSha }));
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // RISK/VALUE CONFIG
    if (url.pathname === "/config") {
      const configPath = env.GITHUB_RISK_CONFIG_PATH || "data/riskValueConfig.json";
      if (request.method === "GET") {
        const { content, sha } = await loadFromGitHub(env, configPath);
        return withCORS(noStoreJson({ ...content, sha }));
      }
      if (request.method === "POST") {
        const body = await request.json();
        const newSha = await saveToGitHub(
          env,
          configPath,
          JSON.stringify(body, null, 2),
          body.sha,
          "Update risk & value config via admin drawer"
        );
        return withCORS(noStoreJson({ sha: newSha }));
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // BORROWERS
    if (url.pathname === "/borrowers") {
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
        const newSha = await saveToGitHub(
          env,
          borrowerPath,
          JSON.stringify(body.borrowers, null, 2),
          body.sha,
          "Update borrowers via admin"
        );
        return withCORS(noStoreJson({ success: true, sha: newSha }));
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    // READ-ONLY: VALUATION CURVES + SCHOOL TIERS
    if (url.pathname === "/valuationCurves" || url.pathname === "/schoolTiers") {
      if (request.method === "GET") {
        const path = url.pathname === "/schoolTiers"
          ? env.GITHUB_SCHOOLTIERS_PATH || "data/schoolTiers.json"
          : env.GITHUB_VALUATION_CURVES_PATH || "data/valuationCurves.json";
        const { content, sha } = await loadFromGitHub(env, path);
        return withCORS(noStoreJson({ ...content, sha }));
      }
      return withCORS(new Response("Method not allowed", { status: 405 }));
    }

    return withCORS(new Response("Not found", { status: 404 }));
  } catch (err) {
    console.error("Worker error:", err);
    return withCORS(noStoreJson({ error: err.message, stack: err.stack || "N/A" }, 500));
  }
}

export default { fetch: handleFetch };
