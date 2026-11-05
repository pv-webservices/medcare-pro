import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// RM-3 drops the retired Clinical AI and dashboard-layout tables. These checks
// pin that the migration drops exactly those tables, in a safe order, with
// every trigger the earlier migrations put on them, and nothing else.
const MIGRATIONS = join(process.cwd(), "prisma/migrations");
const RM3 = "20261104202151_drop_clinical_ai_and_dashboard_layouts";
const DROPPED = [
  "ai_runs", "consultation_recording_consents", "consultation_recordings",
  "consultation_recording_events", "transcription_runs", "clinical_transcripts",
  "transcript_reviews", "clinical_transcript_segments", "transcript_derived_views",
  "transcript_derived_segments", "transcript_speaker_mappings", "transcript_corrections",
  "clinical_fact_extraction_runs", "clinical_fact_candidates", "clinical_fact_evidence",
  "clinical_fact_reviews", "dashboard_layouts",
];

const earlier = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name) && name < RM3)
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const rm3 = readFileSync(join(MIGRATIONS, RM3, "migration.sql"), "utf8");
const statements = rm3
  .split("\n")
  .filter((line) => line.trim() && !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("RM-3 drop migration", () => {
  it("contains only trigger drops, the 17 table drops and the one tenants column drop", () => {
    const tables = statements.filter((s) => /^DROP TABLE/i.test(s)).map((s) => s.match(/`(\w+)`/)![1]);
    expect([...tables].sort()).toEqual([...DROPPED].sort());
    const others = statements.filter((s) => !/^DROP TABLE IF EXISTS/i.test(s) && !/^DROP TRIGGER IF EXISTS/i.test(s));
    expect(others).toEqual(["ALTER TABLE `tenants` DROP COLUMN `allow_gemini_transcription_fallback`"]);
    expect(statements.at(-1)).toBe(others[0]);
  });

  it("drops every trigger the earlier migrations left on the dropped tables, and only those", () => {
    const live = new Map<string, string>();
    for (const sql of earlier) {
      for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi)) live.delete(m[1]);
      for (const m of sql.matchAll(/CREATE\s+(?:DEFINER=\S+\s+)?TRIGGER\s+`?(\w+)`?\s+(?:BEFORE|AFTER)\s+\w+\s+ON\s+`?(\w+)`?/gi)) live.set(m[1], m[2]);
    }
    expect([...live.values()].every((table) => DROPPED.includes(table))).toBe(true);
    const dropped = statements.filter((s) => /^DROP TRIGGER/i.test(s)).map((s) => s.match(/`(\w+)`/)![1]);
    expect([...dropped].sort()).toEqual([...live.keys()].sort());
    expect(live.size).toBe(27);
  });

  it("never creates procedures, functions, events or views that would need dropping", () => {
    for (const sql of earlier) expect(sql).not.toMatch(/CREATE\s+(?:DEFINER=\S+\s+)?(PROCEDURE|FUNCTION|EVENT|VIEW)\b/i);
  });

  it("drops each table only after every table that references it", () => {
    const order = statements.filter((s) => /^DROP TABLE/i.test(s)).map((s) => s.match(/`(\w+)`/)![1]);
    const references: Array<[string, string]> = [];
    for (const sql of earlier) {
      for (const m of sql.matchAll(/ALTER TABLE `(\w+)` ADD CONSTRAINT `\w+` FOREIGN KEY \([^)]*\) REFERENCES `(\w+)`/g)) references.push([m[1], m[2]]);
      for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\)/g))
        for (const ref of m[2].matchAll(/REFERENCES `(\w+)`/g)) references.push([m[1], ref[1]]);
    }
    // The 20 foreign keys information_schema shows into these tables on a fully migrated DB.
    expect(new Set(references.filter(([, parent]) => DROPPED.includes(parent)).map(String)).size).toBe(20);
    for (const [child, parent] of references) {
      if (!DROPPED.includes(parent)) continue;
      // A kept table must never reference a dropped one.
      expect(DROPPED).toContain(child);
      if (child !== parent) expect(order.indexOf(child)).toBeLessThan(order.indexOf(parent));
    }
  });

  it("leaves no model in the schema mapped to a dropped table", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const table of DROPPED) expect(schema).not.toContain(`@@map("${table}")`);
    expect(schema).not.toContain("allow_gemini_transcription_fallback");
  });
});
