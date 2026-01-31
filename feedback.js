(function () {

// ❌ Do not show feedback button inside iframes
if (window.self !== window.top) {
  return;
}
  
  // ===== CONFIG =====
  const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSddSOaPeOoTk_U9uA-SaIl-K7QKtyajEqnNfATra4J4zr_7rw/viewform?usp=header";

  // Replace these after form creation
  const FIELD_PAGE = "entry.1111111111";
  const FIELD_CONTEXT = "entry.2222222222";

  // ==================

  function getPageName() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("admin")) return "Admin";
    if (path.includes("reporting")) return "Reporting";
    if (path.includes("roi")) return "ROI";
    if (path.includes("amort")) return "Amort";
    if (path.includes("earnings")) return "Earnings";

    return "Unknown";
  }

  function buildContext() {
    const params = new URLSearchParams(window.location.search);

    return [
      `Page: ${getPageName()}`,
      `URL: ${window.location.href}`,
      `User: ${params.get("user") || "n/a"}`,
      `Time: ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`
    ].join("\n");
  }

  function openForm() {
    const url = new URL(FORM_URL);

    url.searchParams.set(FIELD_PAGE, getPageName());
    url.searchParams.set(FIELD_CONTEXT, buildContext());

    window.open(url.toString(), "_blank", "noopener");
  }

  function mountButton() {
    if (document.getElementById("feedback-btn")) return;

    const btn = document.createElement("button");
    btn.id = "feedback-btn";
    btn.title = "Leave feedback";
    btn.textContent = "💬";

    btn.onclick = openForm;

    document.body.appendChild(btn);
  }

  // Wait until body exists
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
