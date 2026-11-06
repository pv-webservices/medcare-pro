import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Codex reads project skills from .agents/skills, Claude from .claude/skills.
// AGENTS.md promises the two copies are identical; this keeps that true.
const ROOT = process.cwd();
const SKILLS = ["multi-clinic-data-model", "admin-dashboard-ui", "secure-webhooks"];
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

describe("agent instruction files", () => {
  it.each(SKILLS)("mirrors the %s skill for Codex and Claude", (skill) => {
    const codex = `.agents/skills/${skill}/SKILL.md`;
    const claude = `.claude/skills/${skill}/SKILL.md`;
    expect(existsSync(join(ROOT, codex)), `${codex} is missing`).toBe(true);
    expect(read(codex)).toBe(read(claude));
  });

  it("lists every mirrored skill in AGENTS.md", () => {
    const agents = read("AGENTS.md");
    for (const skill of SKILLS) expect(agents).toContain(`\`${skill}\``);
  });

  it("keeps CLAUDE.md as an import of AGENTS.md so both agents get the same rules", () => {
    expect(read("CLAUDE.md").trim()).toBe("@AGENTS.md");
  });
});
