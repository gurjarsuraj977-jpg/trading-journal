async function api(url, opts = {}) {
  const headers = {
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers || {}),
  };

  let r;
  try {
    r = await fetch(url, {
      credentials: "same-origin",
      ...opts,
      headers,
    });
  } catch (networkErr) {
    /*
     * fetch() throws TypeError ("Failed to fetch") on network failures:
     * offline, DNS, TLS, CORS, server down, cold-start timeout, etc.
     * Distinguish this from API business errors so mobile users see
     * a clear message instead of a raw "Failed to fetch".
     */
    const err = new Error(
      "Network error — could not reach GhostTrader. Check your connection and try again."
    );
    err.isNetwork = true;
    err.cause = networkErr;
    throw err;
  }

  let d = {};
  try {
    d = await r.json();
  } catch {}

  if (r.status === 401) {
    if (!url.includes("/auth/")) location.reload();
    throw Error(d.error || "Session expired");
  }

  if (r.status === 403) {
    const err = Error(d.error || "Forbidden");
    err.status = 403;
    err.code = d.status || null;
    throw err;
  }

  if (r.status === 429) {
    throw Error(d.error || "Too many requests. Please wait and try again.");
  }

  if (!r.ok) throw Error(d.error || "Request failed");

  return d;
}

function showError(m) {
  console.error(m);
  alert(m);
}
