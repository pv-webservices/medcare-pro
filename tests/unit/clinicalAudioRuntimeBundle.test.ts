import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClinicalAudioRuntime,
  CLINICAL_AUDIO_RUNTIME_ENTRIES,
} from "../../scripts/build-clinical-audio-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("clinical-audio production runtime bundle", () => {
  it("emits every cron entry point as a self-contained Node 20 module", async () => {
    const outdir = await mkdtemp(join(tmpdir(), "medcare-clinical-audio-"));
    temporaryDirectories.push(outdir);

    await buildClinicalAudioRuntime(outdir);

    for (const name of Object.keys(CLINICAL_AUDIO_RUNTIME_ENTRIES)) {
      const output = join(outdir, `${name}.mjs`);
      expect((await stat(output)).isFile()).toBe(true);
      const source = await readFile(output, "utf8");
      expect(source).not.toContain("../src/");
      expect(source).not.toContain('from "next/server"');
      expect(source).not.toContain('from "next-auth"');
      expect(source.length).toBeGreaterThan(1000);
    }
  }, 30_000);
});
