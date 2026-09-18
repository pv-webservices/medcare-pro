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
  if (!clinicalAudioCronEnabled())
    return Response.json({ ok: false }, { status: 503, headers });
  return null;
}

export function cronJson(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status, headers });
}
