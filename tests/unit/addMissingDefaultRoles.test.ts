import { describe, expect, it } from "vitest";
import {
  addMissingDefaultRoles,
  DEFAULT_ROLES,
  type PrismaClientOrTransaction,
} from "@/lib/defaultRoles";
import { HISTORICAL_ALL_PERMISSIONS } from "@/lib/permissions";

interface FakeRole {
  tenantId: string;
  name: string;
  key: string | null;
  permissions: string[];
}

/**
 * The two Prisma calls `addMissingDefaultRoles` makes, and nothing else.
 *
 * Written as a fake rather than a mock so the test asserts on the resulting
 * ROWS — what the tenant is left holding — instead of on which methods were
 * called. `update` and `upsert` are deliberately absent: if the function ever
 * grew one, this suite would fail loudly rather than silently permit an
 * overwrite of a tenant's customised role.
 */
function fakeClient(rows: FakeRole[]) {
  const client = {
    role: {
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        rows.filter((row) => row.tenantId === where.tenantId),
      create: async ({ data }: { data: FakeRole }) => {
        rows.push({ ...data });
        return data;
      },
    },
  };
  return client as unknown as PrismaClientOrTransaction;
}

const seeded = (tenantId: string): FakeRole[] => [
  { tenantId, name: "Owner", key: "OWNER", permissions: ["*"] },
  {
    tenantId,
    name: "Admin",
    key: "CLINIC_ADMIN",
    permissions: [...HISTORICAL_ALL_PERMISSIONS],
  },
  { tenantId, name: "Staff", key: "STAFF", permissions: ["clinic:read"] },
];

describe("addMissingDefaultRoles", () => {
  it("adds only the roles the tenant is missing", async () => {
    const rows = seeded("t1");
    const { created } = await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(created).toEqual(["Doctor", "Receptionist"]);
    expect(rows).toHaveLength(5);
  });

  it("never rewrites an existing role's permissions", async () => {
    const rows = seeded("t1");
    // A tenant who narrowed their own Admin role. This is the case that makes
    // the whole create-only path necessary.
    rows[1].permissions = ["clinic:read", "registration:read"];

    await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(rows[1].permissions).toEqual(["clinic:read", "registration:read"]);
  });

  it("leaves a custom role completely alone", async () => {
    const rows = seeded("t1");
    rows.push({
      tenantId: "t1",
      name: "Billing Clerk",
      key: null,
      permissions: ["registration:read"],
    });

    await addMissingDefaultRoles(fakeClient(rows), "t1");

    const custom = rows.find((row) => row.name === "Billing Clerk");
    expect(custom).toEqual({
      tenantId: "t1",
      name: "Billing Clerk",
      key: null,
      permissions: ["registration:read"],
    });
  });

  it("is idempotent — a second run creates nothing", async () => {
    const rows = seeded("t1");
    const client = fakeClient(rows);

    await addMissingDefaultRoles(client, "t1");
    const second = await addMissingDefaultRoles(client, "t1");

    expect(second.created).toEqual([]);
    expect(rows).toHaveLength(5);
  });

  it("does not add a role whose NAME the tenant already uses", async () => {
    const rows = seeded("t1");
    // A tenant who built their own "Doctor" role before we seeded one.
    rows.push({
      tenantId: "t1",
      name: "Doctor",
      key: null,
      permissions: ["patient:read"],
    });

    const { created } = await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(created).toEqual(["Receptionist"]);
    expect(rows.filter((row) => row.name === "Doctor")).toHaveLength(1);
    expect(rows.find((row) => row.name === "Doctor")?.permissions).toEqual([
      "patient:read",
    ]);
  });

  it("does not add a role whose KEY is already claimed under another name", async () => {
    const rows = seeded("t1");
    // A tenant who renamed the seeded Doctor role. Creating a second DOCTOR key
    // would break the unique index the constrain migration adds.
    rows.push({
      tenantId: "t1",
      name: "Consultant",
      key: "DOCTOR",
      permissions: ["patient:read"],
    });

    const { created } = await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(created).toEqual(["Receptionist"]);
    expect(rows.filter((row) => row.key === "DOCTOR")).toHaveLength(1);
  });

  it("seeds the full set for a tenant that has no roles at all", async () => {
    const rows: FakeRole[] = [];
    const { created } = await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(created).toEqual(DEFAULT_ROLES.map((role) => role.name));
    expect(rows).toHaveLength(DEFAULT_ROLES.length);
  });

  it("touches no other tenant's roles", async () => {
    const rows = [...seeded("t1"), ...seeded("t2")];
    await addMissingDefaultRoles(fakeClient(rows), "t1");

    expect(rows.filter((row) => row.tenantId === "t2")).toHaveLength(3);
    expect(rows.filter((row) => row.tenantId === "t1")).toHaveLength(5);
  });

  it("marks everything it creates as a system role", async () => {
    const rows: FakeRole[] = [];
    await addMissingDefaultRoles(fakeClient(rows), "t1");

    for (const row of rows) {
      expect((row as FakeRole & { isSystem?: boolean }).isSystem).toBe(true);
    }
  });
});
