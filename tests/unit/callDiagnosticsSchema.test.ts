import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations/20260902200000_production_call_diagnostics/migration.sql"),
  "utf8",
);

function block(source: string, declaration: string): string {
  const match = source.match(new RegExp(`${declaration} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing ${declaration}`);
  return match[1];
}

describe("Phase 6 production call diagnostics schema", () => {
  it("keeps production calls separate from controlled test calls", () => {
    expect(schema).toContain("model ClinicTelephonyCall {");
    expect(schema).toContain("model ClinicTelephonyCallEvent {");
    expect(schema).toContain("model ClinicTelephonyTestCall {");
    expect(block(schema, "model ClinicTelephonyCall")).not.toContain("testCall");
  });

  it("uses exactly the closed semantic event vocabulary", () => {
    const values = block(schema, "enum ClinicTelephonyCallEventType")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(values).toEqual([
      "CALL_RECEIVED",
      "ROUTED_TO_RECEPTION",
      "ROUTED_TO_IVR",
      "MAIN_MENU_TOMORROW_SLOTS",
      "MAIN_MENU_APPOINTMENT_BOOKING",
      "MAIN_MENU_URGENT_ASSISTANCE",
      "MAIN_MENU_CLINIC_INFORMATION",
      "MAIN_MENU_REPEAT",
      "MAIN_MENU_INVALID_INPUT",
      "MENU_REVISION_REFRESHED",
      "APPOINTMENTS_UNAVAILABLE",
      "RECEPTION_CONNECTED",
      "RECEPTION_FAILED",
      "RECEPTION_FALLBACK_TO_IVR",
      "URGENT_TRANSFER_CONNECTED",
      "URGENT_TRANSFER_FAILED",
      "URGENT_TRANSFER_UNAVAILABLE",
      "BOOKING_FOLLOW_UP_CREATED",
      "CALL_COMPLETED",
    ]);
  });

  it("stores only bounded operational metadata", () => {
    const call = block(schema, "model ClinicTelephonyCall");
    const event = block(schema, "model ClinicTelephonyCallEvent");
    expect(call).toContain("providerCallUuid");
    expect(call).toContain("callerLast4");
    expect(call).toContain("routingModeAtStart");
    expect(call).toContain("phoneMenuSource");
    expect(event).toContain("eventType");
    expect(`${call}\n${event}`).not.toMatch(
      /callerNumber|providerNumber|publicPhone|receptionPhone|urgentPhone|raw|payload|body|authToken|recording|audio|transcript|digit|patient|appointment|hangupCause/i,
    );
  });

  it("enforces provider and event idempotency with query and retention indexes", () => {
    const call = block(schema, "model ClinicTelephonyCall");
    const event = block(schema, "model ClinicTelephonyCallEvent");
    expect(call).toMatch(/providerCallUuid\s+String\s+.*@unique/);
    expect(call).toContain("@unique");
    expect(call).toContain("@@index([clinicId, startedAt]");
    expect(call).toContain("@@index([startedAt]");
    expect(event).toContain("@@unique([callId, eventType]");
    expect(event).toContain("@@index([callId, occurredAt]");
  });

  it("ships one additive migration with cascading event cleanup and no backfill", () => {
    expect(migration).toContain("CREATE TABLE `clinic_telephony_calls`");
    expect(migration).toContain("CREATE TABLE `clinic_telephony_call_events`");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE `Clinic|INSERT INTO/i);
    expect(migration).not.toContain("ClinicTelephonyTestCall");
    expect(migration).not.toContain("TelephonyBookingRequest");
  });
});
