import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { workTranscriptionOnce } from "../src/lib/transcription/worker";

const workerId = `clinical-audio-${randomUUID()}`;
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
try {
  do {
    const processed = await workTranscriptionOnce(workerId, undefined, 1);
    if (process.argv.includes("--once") || stopping) break;
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} catch {
  console.error("Clinical transcription worker stopped; inspect run metadata/configuration.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
