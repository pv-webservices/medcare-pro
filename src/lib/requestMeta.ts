/**
 * Client metadata pulled off a request for the session and audit records.
 *
 * NOTHING HERE AUTHORIZES ANYTHING. Both values are supplied by the client and
 * are trivially forged; they exist so a person reading `app_sessions` or
 * `audit_logs` afterwards can tell one device from another. Never branch on
 * them.
 */

/**
 * Self-hosted behind a proxy, so `x-forwarded-for` is the only source there is;
 * its first entry is the original client.
 */
export function readClientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers?.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return request?.headers?.get("x-real-ip") ?? null;
}

export function readUserAgent(request: Request | undefined): string | null {
  return request?.headers?.get("user-agent") ?? null;
}
