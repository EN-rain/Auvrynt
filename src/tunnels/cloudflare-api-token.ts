/**
 * Fetch the connector token for an existing remotely-managed Cloudflare Tunnel.
 * API credentials are used for this one request and are never persisted.
 */
export function normalizeCloudflareAccountId(value: string): string {
  const accountId = value.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("Cloudflare account ID must be 32 hexadecimal characters.");
  }
  return accountId;
}

export function normalizeCloudflareTunnelId(value: string): string {
  const tunnelId = value.trim().toLowerCase();
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(tunnelId)) {
    throw new Error("Cloudflare tunnel ID must be a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).");
  }
  return tunnelId;
}

export async function fetchCloudflareTunnelToken(
  accountIdInput: string,
  tunnelIdInput: string,
  apiTokenInput: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const accountId = normalizeCloudflareAccountId(accountIdInput);
  const tunnelId = normalizeCloudflareTunnelId(tunnelIdInput);
  const apiToken = apiTokenInput.trim();
  if (apiToken.length < 16 || apiToken.length > 2048 || /[\r\n]/.test(apiToken)) {
    throw new Error("Cloudflare API token must contain 16–2048 characters and no line breaks.");
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
  } catch {
    // Never interpolate the error: request libraries can embed request headers.
    throw new Error("Cloudflare token request failed. Check the network connection and try again.");
  }
  if (!response.ok) {
    throw new Error(`Cloudflare refused the tunnel token request (HTTP ${response.status}). Check account, tunnel ID, and API token permissions.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Cloudflare returned an invalid token response.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Cloudflare returned an invalid token response.");
  }
  const result = payload as { success?: unknown; result?: unknown };
  if (result.success !== true || typeof result.result !== "string"
    || result.result.trim().length < 16 || result.result.trim().length > 2048) {
    throw new Error("Cloudflare did not return a usable tunnel token.");
  }
  return result.result.trim();
}
