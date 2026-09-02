import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    "prisma/migrations/20260902160000_plivo_phase5_test_calls/migration.sql",
  ),
  "utf8",
);
const environment = readFileSync(resolve(".env.example"), "utf8");

describe("Phase 5 additive test-call persistence", () => {
  it("adds a test-only closed lifecycle without changing existing telephony tables", () => {
    expect(schema).toContain("model ClinicTelephonyTestCall");
    expect(schema).toContain("enum ClinicTelephonyTestCallStatus");
    expect(schema).toContain("REQUESTED\n  RINGING\n  ANSWERED\n  COMPLETED\n  FAILED");
    expect(migration).toContain("CREATE TABLE `clinic_telephony_test_calls`");
    expect(migration).not.toMatch(/ALTER TABLE `clinic_telephony_configs`/);
    expect(migration).not.toMatch(/INSERT INTO|UPDATE `|DELETE FROM/);
  });

  it("stores only safe correlation and masked destination data", () => {
    expect(schema).toContain("providerRequestUuid");
    expect(schema).toContain("providerCallUuid");
    expect(schema).toContain("destinationLast4");
    expect(schema).not.toMatch(/model ClinicTelephonyTestCall[\s\S]*authToken/);
    expect(schema).not.toMatch(/model ClinicTelephonyTestCall[\s\S]*fullDestination/);
    expect(schema).not.toMatch(/model ClinicTelephonyTestCall[\s\S]*recording/);
    expect(schema).not.toMatch(/model ClinicTelephonyTestCall[\s\S]*transcript/);
  });

  it("uses a unique active-clinic guard and bounded operational indexes", () => {
    expect(migration).toContain(
      "UNIQUE INDEX `clinic_test_calls_active_clinic_key`(`active_clinic_id`)",
    );
    expect(migration).toContain("clinic_test_calls_clinic_created_idx");
    expect(migration).toContain("clinic_test_calls_requester_created_idx");
    expect(migration).toContain("clinic_test_calls_status_expiry_idx");
  });

  it("documents a blank deployment-controlled destination without committing a number", () => {
    expect(environment).toContain('PLIVO_TEST_CALL_DESTINATION=""');
    const line = environment
      .split(/\r?\n/)
      .find((value) => value.startsWith("PLIVO_TEST_CALL_DESTINATION="));
    expect(line).toBe('PLIVO_TEST_CALL_DESTINATION=""');
  });
});
