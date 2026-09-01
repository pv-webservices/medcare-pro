import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    "prisma/migrations/20260902120000_clinic_ivr_profiles/migration.sql",
  ),
  "utf8",
);
const answerWebhook = readFileSync(
  resolve("src/app/api/webhooks/plivo/answer/route.ts"),
  "utf8",
);
const inputWebhook = readFileSync(
  resolve("src/app/api/webhooks/plivo/input/route.ts"),
  "utf8",
);
const liveIvr = readFileSync(resolve("src/lib/telephony/ivr.ts"), "utf8");
const liveRouting = readFileSync(
  resolve("src/lib/telephony/routing.ts"),
  "utf8",
);

describe("Phase 2A IVR profile Prisma foundation", () => {
  it("adds optional clinic-owned profile and cascading menu relations", () => {
    expect(schema).toContain("ivrProfile      ClinicIvrProfile?");
    expect(schema).toContain("model ClinicIvrProfile {");
    expect(schema).toContain("clinicId         String   @unique");
    expect(schema).toContain("model ClinicIvrMenuItem {");
    expect(schema).toContain(
      "profile ClinicIvrProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)",
    );
  });

  it("uses a closed database action vocabulary and all required unique constraints", () => {
    expect(schema).toContain("enum ClinicIvrMenuAction {");
    for (const action of [
      "TOMORROW_SLOTS",
      "APPOINTMENT_BOOKING",
      "URGENT_ASSISTANCE",
      "CLINIC_INFORMATION",
    ]) {
      expect(schema).toContain(action);
      expect(migration).toContain(`'${action}'`);
    }
    expect(schema).toContain("@@unique([profileId, digit])");
    expect(schema).toContain("@@unique([profileId, position])");
    expect(schema).toContain("@@unique([profileId, action])");
  });

  it("enforces digit and position ranges plus cascading foreign keys in SQL", () => {
    expect(migration).toContain("CHECK (`digit` BETWEEN 1 AND 7)");
    expect(migration).toContain("CHECK (`position` BETWEEN 0 AND 6)");
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2);
    expect(migration).not.toContain("INSERT INTO");
    expect(migration).not.toContain("clinic_telephony_configs`");
    expect(migration).not.toContain("clinic_business_hours`");
  });

  it("keeps profile fields as bounded strings without a second enable switch", () => {
    expect(schema).toContain(
      "greetingTemplate String   @map(\"greeting_template\") @db.VarChar(500)",
    );
    expect(schema).toContain("language         String   @db.VarChar(16)");
    expect(schema).toContain("voice            String   @db.VarChar(16)");
    const profileBlock = schema.slice(
      schema.indexOf("model ClinicIvrProfile {"),
      schema.indexOf("model ClinicIvrMenuItem {"),
    );
    expect(profileBlock).not.toMatch(/\benabled\b/);
    expect(profileBlock).not.toContain("speechRate");
  });
});

describe("Phase 2B static fallback and management isolation", () => {
  it("retains the original deterministic prompt and routing infrastructure", () => {
    expect(liveIvr).toContain("buildMainMenuPrompt");
    expect(liveIvr).toContain("MAIN_MENU_ROUTES");
    expect(liveRouting).toContain("export const MAIN_MENU_ROUTES");
    expect(liveRouting).toContain("export function resolveMainMenuAction");
  });

  it.each([
    ["answer webhook", answerWebhook],
    ["input webhook", inputWebhook],
  ])("never calls the actor management API from the %s", (_name, source) => {
    expect(source).not.toContain("getClinicIvrProfileForActor");
    expect(source).not.toContain("/telephony/ivr-profile");
    expect(source).not.toContain("ActorContext");
  });

  it("does not persist a runtime revision or add a Phase 2B schema field", () => {
    expect(schema).not.toContain("ivrRevision");
    expect(schema).not.toContain("ivr_revision");
  });
});
