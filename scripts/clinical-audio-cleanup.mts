import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { cleanupAudioOnce, cleanupProviderArtifactOnce } from "../src/lib/clinical-audio/cleanup";
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
try {
  do {
    await cleanupAudioOnce();
    if (!stopping) await cleanupProviderArtifactOnce();
    if (stopping || process.argv.includes("--once")) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping);
} catch { console.error("Clinical audio cleanup stopped; inspect storage/configuration metadata."); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
