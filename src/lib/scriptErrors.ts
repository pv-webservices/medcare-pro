/**
 * A one-line, log-safe description of an error for setup scripts (backfills).
 *
 * It keeps what an operator needs to act: the error name, the Prisma or driver
 * code (P1001, P2002, ECONNREFUSED…) and the reason. It never prints the
 * DATABASE_URL, credentials, or data:
 *   - Prisma request errors open with an "Invalid `prisma.x()` invocation" code
 *     frame; only the reason line is kept, never the frame or the source path.
 *   - Any URL, and the user, password and host of DATABASE_URL, are redacted
 *     (an authentication failure names the database user and server).
 *   - A PrismaClientValidationError echoes the query's arguments, which can be
 *     patient or clinical data, so its message is omitted entirely.
 */
const MAX_MESSAGE = 300;

function secretsFromUrl(databaseUrl: string | undefined): string[] {
  if (!databaseUrl) return [];
  try {
    const url = new URL(databaseUrl);
    return [databaseUrl, decodeURIComponent(url.password), decodeURIComponent(url.username), url.hostname]
      .filter((value) => value.length >= 3);
  } catch {
    return [databaseUrl];
  }
}

export function describeScriptError(error: unknown, databaseUrl: string | undefined = process.env.DATABASE_URL): string {
  if (!(error instanceof Error)) return `name=${typeof error}`;
  // Request errors carry `code`; initialization errors carry `errorCode`.
  const { code: requestCode, errorCode } = error as { code?: unknown; errorCode?: unknown };
  const code = requestCode ?? errorCode;
  const parts = [`name=${error.name}`];
  if (typeof code === "string" && code) parts.push(`code=${code}`);
  if (error.name === "PrismaClientValidationError") {
    parts.push("message=(omitted: a validation error echoes query arguments)");
    return parts.join(" ");
  }
  // Drop Prisma's code frame (the "Invalid `prisma.x()` invocation" header, the source path and
  // the numbered source lines); the first line left is the reason.
  const reason = error.message.split("\n").map((line) => line.trim()).find((line) => line
    && !/^Invalid `.*` invocation/.test(line) && !/\S+:\d+:\d+$/.test(line) && !/^(→\s*)?\d+\s/.test(line)) ?? "";
  let message = reason.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<redacted-url>");
  for (const secret of secretsFromUrl(databaseUrl).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join("<redacted>");
  }
  if (message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE)}…`;
  if (message) parts.push(`message=${message}`);
  return parts.join(" ");
}
