/**
 * Gives every existing customer account the clinic it should have been created
 * with.
 *
 *     npm run clinics:backfill            # report only, writes nothing
 *     npm run clinics:backfill -- --apply # actually writes
 *
 * WHY THIS EXISTS. Signup collected the clinic's name, city and address, wrote
 * all three onto the TENANT, and created no `clinics` row. Every clinical table
 * — doctors, patients, registrations, appointments — is scoped by `clinic_id`,
 * so those accounts had nowhere to put any record: the modules rendered and
 * every one of them was permanently empty. The only screen that could create a
 * clinic was the Clinics tab, which has now been removed, so an account in that
 * state can no longer fix itself.
 *
 * api/auth/signup creates the row from now on. This is the same change applied
 * backwards, to accounts that already exist.
 *
 * THE ONE RULE, INHERITED FROM THE OTHER BACKFILLS IN THIS FOLDER: a tenant is
 * touched only when it has ZERO clinics. An account that already has one — or
 * several, which the data model still allows — is left byte-for-byte alone. This
 * script never renames, never merges and never deletes; its only verb is create,
 * and only into an empty set.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It skips the reserved platform tenant. That row is the Owner's own
 *     bookkeeping, not a customer, and a clinic hanging off it would surface in
 *     customer-facing lists. See lib/platformTenant.ts.
 *   - It does not care about tenant status. A PENDING or REJECTED application
 *     gets its clinic too: the row is what its records will hang off if it is
 *     ever approved, and withholding it would just recreate this problem later.
 *   - It copies no logo or theme colour. Those have never lived on the tenant,
 *     so there is nothing to copy; they are set in Settings -> Clinic details.
 */

import { PrismaClient } from "@prisma/client";
import { CUSTOMER_TENANT_WHERE } from "../src/lib/platformTenant";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

interface Candidate {
  tenantId: string;
  businessName: string;
  city: string | null;
  address: string | null;
}

async function findCandidates(): Promise<Candidate[]> {
  const tenants = await prisma.tenant.findMany({
    where: {
      ...CUSTOMER_TENANT_WHERE,
      // `none` rather than a count in JS: the filter belongs in the database, so
      // an account that gains a clinic between this read and the write below is
      // simply not returned.
      clinics: { none: {} },
    },
    select: {
      id: true,
      businessName: true,
      city: true,
      address: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return tenants.map((tenant) => ({
    tenantId: tenant.id,
    businessName: tenant.businessName,
    city: tenant.city,
    address: tenant.address,
  }));
}

async function main(): Promise<void> {
  console.log(
    `\nBackfill: one clinic per customer account${APPLY ? " (APPLYING)" : " (dry run)"}\n`,
  );

  const candidates = await findCandidates();

  if (candidates.length === 0) {
    console.log("Every customer account already has at least one clinic. Nothing to do.\n");
    return;
  }

  console.log(`${candidates.length} account(s) with no clinic:\n`);
  for (const candidate of candidates) {
    console.log(
      `  ${candidate.businessName}` +
        `${candidate.city ? ` — ${candidate.city}` : ""}` +
        `  [tenant ${candidate.tenantId}]`,
    );
  }

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply.\n");
    return;
  }

  let created = 0;
  for (const candidate of candidates) {
    // Guarded on `none` again inside the write. Two runs racing, or a signup
    // landing mid-run, must not leave an account with two clinics — and
    // createMany cannot express "only if none exist".
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.clinic.count({
        where: { tenantId: candidate.tenantId },
      });
      if (existing > 0) {
        return false;
      }
      await tx.clinic.create({
        data: {
          tenantId: candidate.tenantId,
          name: candidate.businessName,
          city: candidate.city,
          address: candidate.address,
        },
      });
      return true;
    });

    if (result) {
      created += 1;
      console.log(`  created clinic for ${candidate.businessName}`);
    } else {
      console.log(`  skipped ${candidate.businessName} — gained a clinic mid-run`);
    }
  }

  console.log(`\nDone. ${created} clinic(s) created.\n`);
}

main()
  .catch((error: unknown) => {
    console.error("\nScript error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
