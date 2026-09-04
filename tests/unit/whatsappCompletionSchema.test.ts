import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations/20260904190000_complete_whatsapp_provider_management/migration.sql"), "utf8");
describe("completed WhatsApp provider schema", () => {
  it("keeps provider accounts many-per-tenant and adds per-account device limits", () => {
    const model = schema.match(/model WhatsappProviderAccount \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(model).toContain("deviceLimit");
    expect(model).not.toContain("tenantId        String   @unique");
  });
  it("preserves default as primary and uses additive safe defaults", () => {
    expect(migration).toContain("`backup_device_id` VARCHAR(191) NULL");
    expect(migration).toContain("`automatic_failover` BOOLEAN NOT NULL DEFAULT false");
    expect(migration).toContain("`device_limit` INTEGER NOT NULL DEFAULT 2");
    expect(migration).toContain("DEFAULT 'UNKNOWN'");
    expect(migration).not.toMatch(/UPDATE `tenant_whatsapp_settings`/);
  });
  it("keeps immutable sender history when a device row is removed", () => {
    expect(schema).toContain('senderNumber      String?  @map("sender_number")');
    expect(schema).toContain("whatsappDevice WhatsappDevice? @relation(fields: [whatsappDeviceId], references: [id], onDelete: SetNull)");
  });
});
