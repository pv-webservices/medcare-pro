import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("clinic capacity architecture", () => {
  const schema = read("prisma/schema.prisma");
  const clinics = read("src/lib/clinics.ts");
  const customer = read("src/lib/clinicCapacityRequests.ts");
  const platform = read("src/lib/platform/clinicCapacity.ts");
  const api = read("src/app/api/clinics/route.ts");

  it("stores allowance and decimal pricing on Plan", () => {
    expect(schema).toContain("includedClinics");
    expect(schema).toContain("@default(2)");
    expect(schema).toContain("@db.Decimal(10, 2)");
  });

  it("models auditable grants and requests with a one-grant-per-request defense", () => {
    expect(schema).toContain("model TenantClinicCapacityGrant");
    expect(schema).toContain("model ClinicCapacityRequest");
    expect(schema).toContain("sourceRequestId");
    expect(schema).toContain("@unique");
  });

  it("keeps migration identifiers within MariaDB's 64-character limit", () => {
    const migration = read("prisma/migrations/20260912120000_clinic_capacity/migration.sql");
    const names = [...migration.matchAll(/(?:INDEX|CONSTRAINT) `([^`]+)`/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(64);
    expect(migration).toContain("`requested_quantity` IS NOT NULL AND `requested_quantity` >= 1");
  });

  it("serializes capacity and clinic insertion under a parameterized tenant row lock", () => {
    expect(clinics).toContain('requirePermission(actor, "clinic:create")');
    expect(clinics).toContain("lockTenantForClinicCapacity(tx, actor.tenantId)");
    expect(clinics).toContain("assertClinicCapacityAvailable(actor.tenantId, tx)");
    expect(clinics).toContain("return tx.clinic.create");
    expect(api).toContain("createClinic(actor, input)");
  });

  it("keeps historical active planless tenants on an explicit Standard-plan compatibility allowance", () => {
    const resolver = read("src/lib/clinicCapacity.ts");
    expect(resolver).toContain("DEFAULT_PLAN_KEY");
    expect(resolver).toContain("usesCompatibilityPlan");
    expect(resolver).toContain("capacityConfigured");
    expect(resolver).toContain("tenant.status === \"ACTIVE\"");
  });

  it("derives customer tenant and actor IDs from session context", () => {
    expect(customer).toContain("tenantId: actor.tenantId");
    expect(customer).toContain("requestedById: actor.userId");
    expect(customer).not.toContain("input.tenantId");
  });

  it("keeps platform writes behind the platform context and idempotent approval", () => {
    expect(platform).toContain("owner: PlatformActorContext");
    expect(platform).toContain('if (request.status === "APPROVED")');
    expect(platform).toContain("sourceRequestId: request.id");
    expect(platform).toContain("acceptFeatureLoss");
    expect(platform).toContain("clinicCapacityTransactionOptions");
    expect(read("src/lib/clinicCapacity.ts")).toContain("Prisma.TransactionIsolationLevel.ReadCommitted");
  });
});
