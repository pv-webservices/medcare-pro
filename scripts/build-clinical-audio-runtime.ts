import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export const CLINICAL_AUDIO_RUNTIME_ENTRIES = {
  worker: "scripts/clinical-audio-worker.mts",
  cleanup: "scripts/clinical-audio-cleanup.mts",
  health: "scripts/clinical-audio-health.mts",
} as const;

export async function buildClinicalAudioRuntime(
  outdir = resolve(".next/server/clinical-audio"),
) {
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: CLINICAL_AUDIO_RUNTIME_ENTRIES,
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    outExtension: { ".js": ".mjs" },
    sourcemap: false,
    logLevel: "info",
    tsconfig: "tsconfig.json",
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  void buildClinicalAudioRuntime().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Runtime bundle failed.");
    process.exitCode = 1;
  });
}
