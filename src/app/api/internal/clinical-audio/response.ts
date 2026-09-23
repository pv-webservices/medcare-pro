import {
  authenticateClinicalAudioCron,
  clinicalAudioCronEnabled,
} from "@/lib/clinical-audio/cronAuth";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export function authorizeClinicalAudioCron(request: Request): Response | null {
  const auth = authenticateClinicalAudioCron(request);
  if (auth === "unconfigured")
    return Response.json({ ok: false }, { status: 503, headers });
  if (auth !== "authorized")
    return Response.json({ ok: false }, { status: 401, headers });
  // Authenticated, but the feature is switched off: nothing to do is not a
  // failure, and saying so lets operators confirm the cron credentials work.
  if (!clinicalAudioCronEnabled())
    return Response.json({ ok: true, enabled: false }, { status: 200, headers });
  return null;
}

export function cronJson(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status, headers });
}

/** Operators need to see a failing pass; the message may carry clinical or
 * storage detail, so only a bounded failure category is logged. */
export function cronFailure(
  route: "worker" | "cleanup" | "health",
  error: unknown,
) {
  const code = (error as { code?: unknown } | null)?.code;
  const failure =
    typeof code === "string" && /^[A-Z][A-Z_]{0,63}$/.test(code)
      ? code
      : error instanceof Error
        ? error.name
        : "UNKNOWN";
  console.error("Clinical audio cron pass failed.", { route, failure });
  return cronJson({ ok: false }, 503);
}
