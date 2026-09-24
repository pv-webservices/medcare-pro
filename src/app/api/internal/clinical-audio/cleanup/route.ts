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

/** Items per call. Each pass claims one leased item; a failed deletion is
 * rescheduled, so it is not reclaimed within the same call. */
const CLEANUP_BATCH = 25;

async function drain(pass: () => Promise<number>) {
  let processed = 0;
  while (processed < CLEANUP_BATCH && (await pass()) > 0) processed++;
  return processed;
}

export async function POST(request: Request) {
  const denied = authorizeClinicalAudioCron(request);
  if (denied) return denied;

  try {
    // Retention deletion must keep pace with expiry, not one item per run.
    const recordings = await drain(() => cleanupAudioOnce());
    const providerArtifacts = await drain(() => cleanupProviderArtifactOnce());
    return cronJson({ ok: true, recordings, providerArtifacts });
  } catch (error) {
    return cronFailure("cleanup", error);
  }
}
