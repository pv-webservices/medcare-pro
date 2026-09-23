import { prisma } from "@/lib/prisma";
import { createClinicalAiFixture } from "./clinical-ai-test-fixture";
export function assertClinicalAudioDatabase() {
  const url = new URL(process.env.DATABASE_URL || "mysql://invalid");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.startsWith("/medcare_ep_ai2a1")
  )
    throw new Error(
      "Clinical audio writes require a disposable localhost medcare_ep_ai2a1 database.",
    );
}
export async function createClinicalAudioFixture() {
  assertClinicalAudioDatabase();
  process.env.AI_ENABLED = "true";
  process.env.CLINICAL_AUDIO_ENABLED = "true";
  process.env.RECORDING_STORAGE_PROVIDER = "memory";
  const f = await createClinicalAiFixture(prisma);
  await prisma.role.update({
    where: { id: f.roleId },
    data: {
      permissions: [
        ...f.originalPermissions,
        "clinical-ai:writing",
        "clinical-ai:recording",
        "clinical-ai:transcription",
        "clinical-ai:transcript-read",
        "clinical-ai:facts-extract",
        "clinical-ai:facts-review",
      ],
    },
  });
  return f;
}
