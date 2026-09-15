// Explicit live acceptance harness: only the locally generated synthetic WAV.
import "dotenv/config";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { GeminiTranscriptionProvider, getGeminiTranscriptionConfig } from "../src/lib/transcription/providers/gemini";
import { readBoundedProviderJson } from "../src/lib/transcription/normalize";
const path = resolve(tmpdir(), "medcare-ai2a3-synthetic-dialogue.wav");
const resultPath = resolve(tmpdir(), "medcare-ai2a3-synthetic-gemini-result.json");
if (!(process.env.GEMINI_TRANSCRIPTION_API_KEY || process.env.GEMINI_API_KEY)?.trim()) console.log("NOT RUN — local Gemini transcription credential unavailable");
else {
  let artifactName: string | null = null; let artifactDeleted = false;
  try {
    const data = await readFile(path);
    if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") throw new Error("SYNTHETIC_WAV_INVALID");
    const byteRate = data.readUInt32LE(28); const durationMs = Math.round((data.length - 44) / byteRate * 1000);
    const config = getGeminiTranscriptionConfig({ ...process.env, TRANSCRIPTION_FALLBACK_PROVIDER: "gemini", TRANSCRIPTION_AUTO_FALLBACK: "false" });
    const guardedSyntheticTransport: typeof fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (String(url).endsWith("/v1beta/interactions") && response.ok) {
        const payload = await readBoundedProviderJson(response.clone());
        if (payload && typeof payload === "object") {
          const object = payload as Record<string, unknown>;
          // Dedicated synthetic fixture only: strip input/provider file references.
          const safe = { syntheticOnly: true, id: object.id, status: object.status, output_text: object.output_text, topLevelKeys: Object.keys(object), steps: Array.isArray(object.steps) ? object.steps.filter(s => s && typeof s === "object" && s.type === "model_output") : [] };
          await writeFile(resolve(tmpdir(), "medcare-ai2a3-synthetic-gemini-contract.json"), JSON.stringify(safe, null, 2));
        }
      }
      return response;
    };
    const source = await new GeminiTranscriptionProvider(config, guardedSyntheticTransport).transcribe({ stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, bytes: data.length, mime: "audio/wav", durationMs, signal: AbortSignal.timeout(240_000), artifact: async (name, deleted) => { artifactName = name; artifactDeleted = deleted; } });
    await writeFile(resultPath, JSON.stringify({ syntheticOnly: true, source, durationMs, artifactDeleted, ...(artifactDeleted ? {} : { artifactName }) }, null, 2));
    console.log(JSON.stringify({ result: "RUN — SYNTHETIC AUDIO ONLY", parser: "PASS", durationMs, segmentCount: source.segments.length, speakerCount: new Set(source.segments.map(s => s.speakerLabel)).size, artifactDeleted, clinicalAnchorReview: "REQUIRED — dedicated synthetic result artifact" }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "INVALID_RESPONSE";
    await writeFile(resultPath, JSON.stringify({ syntheticOnly: true, result: "FAIL", failureCode: code, artifactDeleted, ...(artifactDeleted ? {} : { artifactName }) }, null, 2));
    console.log(JSON.stringify({ result: "RUN — SYNTHETIC AUDIO ONLY", acceptance: "FAIL", failureCode: code, artifactDeleted })); process.exitCode = 1;
  }
}
