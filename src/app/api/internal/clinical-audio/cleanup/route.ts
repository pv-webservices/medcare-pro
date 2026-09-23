import {
  cleanupAudioOnce,
  cleanupProviderArtifactOnce,
} from "@/lib/clinical-audio/cleanup";
import {
  authorizeClinicalAudioCron,
  cronFailure,
  cronJson,
} from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = authorizeClinicalAudioCron(request);
  if (denied) return denied;

  try {
    const recordings = await cleanupAudioOnce();
    const providerArtifacts = await cleanupProviderArtifactOnce();
    return cronJson({ ok: true, recordings, providerArtifacts });
  } catch (error) {
    return cronFailure("cleanup", error);
  }
}
