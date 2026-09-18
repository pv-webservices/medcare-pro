import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getClinicalAudioHealth } from "../src/lib/clinical-audio/health";
try {
  console.log(JSON.stringify(await getClinicalAudioHealth()));
} catch { console.error("Clinical audio health check unavailable."); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
