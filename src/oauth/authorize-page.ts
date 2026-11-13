function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface AuthorizePageParams {
  requestId: string;
  csrfToken: string;
  clientName: string;
  scopes: string[];
  errorMessage?: string;
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
  const clientName = escapeHtml(params.clientName);
  const scopesText =
    params.scopes.length > 0
      ? escapeHtml(params.scopes.join(" "))
      : "Full Homebox access";
  const errorBanner = params.errorMessage
    ? `<div role="alert" style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:6px;margin-bottom:16px;">${escapeHtml(params.errorMessage)}</div>`
    : "";

  const requestId = escapeHtml(params.requestId);
  const csrfToken = escapeHtml(params.csrfToken);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${clientName} — Homebox MCP</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:460px;margin:48px auto;padding:0 16px;color:#111827;">
  <h1 style="font-size:1.25rem;margin-bottom:8px;">Authorize ${clientName}</h1>
  <p style="color:#4b5563;margin-top:0;">Sign in with your Homebox credentials or enter an existing Homebox API key to grant this MCP client access to your Homebox inventory.</p>
  <p style="font-size:0.875rem;color:#6b7280;">Requested scope: <code>${scopesText}</code></p>
  ${errorBanner}
  <form method="POST" action="/authorize/login" style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">
    <input type="hidden" name="request_id" value="${requestId}" />
    <input type="hidden" name="csrf_token" value="${csrfToken}" />
    <h2 style="font-size:1rem;margin:0;">Homebox Username &amp; Password</h2>
    <label for="username" style="font-weight:600;font-size:0.875rem;">Username or Email</label>
    <input
      id="username"
      name="username"
      type="text"
      required
      autocomplete="username"
      style="padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;"
    />
    <label for="password" style="font-weight:600;font-size:0.875rem;">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      required
      autocomplete="current-password"
      style="padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;"
    />
    <button
      type="submit"
      style="padding:10px 16px;background:#111827;color:#ffffff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;"
    >
      Sign in &amp; Authorize
    </button>
  </form>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
  <form method="POST" action="/authorize/login" style="display:flex;flex-direction:column;gap:12px;">
    <input type="hidden" name="request_id" value="${requestId}" />
    <input type="hidden" name="csrf_token" value="${csrfToken}" />
    <h2 style="font-size:1rem;margin:0;">Or use a Homebox API Key</h2>
    <label for="api_key" style="font-weight:600;font-size:0.875rem;">Homebox API Key</label>
    <input
      id="api_key"
      name="api_key"
      type="password"
      required
      autocomplete="off"
      placeholder="hb_..."
      style="padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;"
    />
    <button
      type="submit"
      style="padding:10px 16px;background:#374151;color:#ffffff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;"
    >
      Authorize with API Key
    </button>
  </form>
</body>
</html>`;
}
