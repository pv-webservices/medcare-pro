/**
 * Platform Owner provisioning — Stage 2.
 *
 *     OWNER_EMAIL=... OWNER_NAME=... OWNER_PASSWORD=... npm run create-owner
 *
 * THERE IS NO PUBLIC OWNER REGISTRATION ROUTE, and there must never be one. An
 * Owner can approve, suspend and read across every clinic on the platform; the
 * only way to mint one is with shell access to the deployment.
 *
 * The password is read from the ENVIRONMENT, never from argv. Arguments are
 * visible to every process on the host through /proc and `ps`, and land in
 * shell history; environment variables of an already-running process are not.
 *
 * IDEMPOTENT. Re-running with the same email is a no-op that exits 0, so it is
 * safe in a deploy script. Creating a SECOND, different Owner is refused unless
 * ALLOW_ADDITIONAL_OWNER=1 is set deliberately.
 *
 * Unlike the Stage 1 scripts this is NOT localhost-guarded: provisioning the
 * first Owner on a real deployment is exactly what it is for. It writes only to
 * `users`, `tenants` (the reserved row) and `audit_logs`, and never touches
 * customer data.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { ensurePlatformTenant } from "@/lib/platform/tenant";
import { OWNER_PLATFORM_ROLE } from "@/lib/platform/context";

/** Matches src/app/api/auth/signup/route.ts — one password policy, not two. */
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

const inputSchema = z.object({
  email: z.email().max(255),
  name: z.string().trim().min(1, "OWNER_NAME is required").max(255),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH),
});

function fail(message: string): never {
  console.error(`create-owner: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = inputSchema.safeParse({
    email: process.env.OWNER_EMAIL?.trim().toLowerCase(),
    name: process.env.OWNER_NAME,
    password: process.env.OWNER_PASSWORD,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    fail(`${detail}. Set OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD.`);
  }

  const { email, name, password } = parsed.data;
  const allowAdditional = process.env.ALLOW_ADDITIONAL_OWNER === "1";

  // 1. Already provisioned with this address? Nothing to do.
  const sameEmail = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      platformRole: true,
      accountStatus: true,
      tenant: { select: { isPlatform: true } },
    },
  });

  if (sameEmail?.platformRole === OWNER_PLATFORM_ROLE) {
    console.log(`create-owner: ${email} is already a Platform Owner (${sameEmail.id}).`);
    console.log("create-owner: nothing to do.");
    return;
  }

  // 2. The address belongs to somebody else. Promoting an existing customer
  //    user would hand platform-wide reach to an account that lives inside a
  //    customer tenant, and would keep their clinic memberships alongside it.
  //    That is a privilege-escalation path, not a convenience.
  if (sameEmail) {
    fail(
      `${email} already exists as a ${sameEmail.tenant.isPlatform ? "platform" : "clinic"} user (${sameEmail.id}). ` +
        "Refusing to promote an existing account. Use a dedicated Owner address.",
    );
  }

  // 3. A different Owner already exists. Refuse by default: "no duplicate
  //    Owners" is the requirement, and a second one appearing by accident in a
  //    deploy script is the failure worth preventing.
  const existingOwners = await prisma.user.findMany({
    where: { platformRole: OWNER_PLATFORM_ROLE },
    select: { id: true, email: true },
  });

  if (existingOwners.length > 0 && !allowAdditional) {
    const list = existingOwners.map((owner) => owner.email).join(", ");
    fail(
      `a Platform Owner already exists (${list}). Refusing to create a second. ` +
        "Set ALLOW_ADDITIONAL_OWNER=1 if that is genuinely intended.",
    );
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const owner = await prisma.$transaction(async (tx) => {
    const platformTenantId = await ensurePlatformTenant(tx, now);

    const created = await tx.user.create({
      data: {
        tenantId: platformTenantId,
        name,
        email,
        passwordHash,
        // Verified on creation: there is no mailbox round-trip for an account
        // provisioned by whoever already holds shell access to the deployment,
        // and src/lib/auth.ts blocks login on an unverified user's tenant.
        emailVerifiedAt: now,
        accountStatus: "ACTIVE",
        // ACTIVE, but never consulted for an Owner: lib/platform/context.ts
        // deliberately ignores membershipStatus so that no Tenant Admin can
        // reach it. The column is NOT NULL, so it still needs a value.
        membershipStatus: "ACTIVE",
        platformRole: OWNER_PLATFORM_ROLE,
      },
      select: { id: true, email: true, name: true },
    });

    // No UserRole row is created. An Owner is not staff of any clinic, and
    // giving them one would put them inside the tenant RBAC system they are
    // meant to sit outside of.

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.OWNER_CREATED,
      targetType: "User",
      targetId: created.id,
      // Null actor: provisioning is done from a shell, not by a signed-in user.
      actorUserId: null,
      actorTenantId: null,
      afterValue: {
        email: created.email,
        name: created.name,
        platformRole: OWNER_PLATFORM_ROLE,
        accountStatus: "ACTIVE",
      },
      reason: "Provisioned by the create-owner command.",
    });

    return created;
  });

  console.log(`create-owner: created Platform Owner ${owner.email} (${owner.id}).`);
  console.log("create-owner: sign in at /owner/login.");
}

main()
  .catch((error: unknown) => {
    console.error("create-owner failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
