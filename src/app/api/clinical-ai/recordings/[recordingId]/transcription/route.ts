import { audioError } from "@/lib/clinical-audio/api";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
// AI-2A.1 ends at READY; transcription requests are reserved for AI-2A.2.
export async function POST() {
  return audioError(new ClinicalAudioDisabledError());
}
