import { getClinicalAudioHealth } from "@/lib/clinical-audio/health";
import {
  authorizeClinicalAudioCron,
  cronFailure,
  cronJson,
} from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = authorizeClinicalAudioCron(request);
  if (denied) return denied;

  try {
    return cronJson({ ok: true, ...(await getClinicalAudioHealth()) });
  } catch (error) {
    return cronFailure("health", error);
  }
}
