import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { readdir } from "node:fs/promises";
import { clinicalAudioPreflight } from "../src/lib/clinical-audio/preflight";
let fallbackRequired = false;
try { fallbackRequired = (await prisma.tenant.count({ where: { allowGeminiTranscriptionFallback: true, isPlatform: false, status: "ACTIVE" } })) > 0; } catch {}
const result = clinicalAudioPreflight(process.env, fallbackRequired);
console.log(result.state);
for (const check of result.checks) console.log(`${check.result} ${check.name}`);
let migrationValid = false;
try {
  const expected = (await readdir("prisma/migrations", { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
  const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  migrationValid = expected.every(name => applied.some(m => m.migration_name === name && m.finished_at && !m.rolled_back_at)) && !applied.some(m => !m.finished_at && !m.rolled_back_at);
} catch { /* Report only the result; database credentials never printed. */ }
finally { await prisma.$disconnect(); }
console.log(`${migrationValid ? "PASS" : "FAIL"} database migration status`);
if (process.env.CLINICAL_AUDIO_ENABLED === "true" && (!migrationValid || result.checks.some(c => c.result === "FAIL"))) process.exitCode = 1;
