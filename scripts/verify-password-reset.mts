/**
 * Verification — the "Forgot password?" flow, against a LOCAL database.
 *
 *     npm run verify:password-reset
 *
 * What it proves, against the real modules rather than reimplementations:
 *
 *   - an unregistered address is reported as `unknown-account` (the ONE account
 *     fact this flow discloses, by product decision — see AccountNotFoundError
 *     in src/lib/auth.ts);
 *   - a registered address gets a link, and the raw token is nowhere in the
 *     database — only its SHA-256 digest is;
 *   - redeeming the link changes the password AND revokes every live session;
 *   - the same link cannot be redeemed twice;
 *   - an expired link is refused, and refusing it destroys the row;
 *   - a token minted for email verification cannot be redeemed as a password
 *     reset, and a reset token cannot be redeemed as a verification — the
 *     purpose discriminator holds in both directions;
 *   - requesting a second link invalidates the first;
 *   - a SUSPENDED user may still reset (their password is theirs; whether they
 *     may then log in is decided at login), while the platform tenant may not
 *     and is refused with the SAME neutral answer as a successful send;
 *   - the per-address rate limit refuses the fourth request in a window.
 *
 * NO REAL MAIL IS EVER SENT. The mailer is injected as a capture function, which
 * is also how this script learns the raw token at all — nothing reads it from
 * the database, because nothing can.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createAppSession } from "@/lib/appSession";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { ensurePlatformTenant } from "@/lib/platform/tenant";
import { RATE_LIMIT_POLICIES, RateLimitError, createDatabaseRateLimiter } from "@/lib/rateLimit";
import {
  RESET_LINK_TTL_MINUTES,
  RESET_REQUESTED_MESSAGE,
  buildPasswordResetUrl,
  confirmPasswordReset,
  isPasswordResetTokenLive,
  requestPasswordReset,
  type PasswordResetMailer,
} from "@/lib/passwordReset";
import {
  consumeVerificationToken,
  hashToken,
  issueVerificationToken,
} from "@/lib/verification";
import { VERIFICATION_PURPOSES } from "@/lib/verificationPurpose";
import type { TenantStatus, UserAccountStatus } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

// buildPasswordResetUrl needs an origin. Set only if the environment has none,
// so a developer's real value is never overwritten.
process.env.NEXTAUTH_URL ??= "http://127.0.0.1:3000";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

const RUN = Date.now();
const SLUG_PREFIX = `verify-pwreset-${RUN}`;
const OLD_PASSWORD = "old-password-that-is-long";
const NEW_PASSWORD = "new-password-that-is-long";

/**
 * Captures what would have been mailed. The ONLY place the raw token is visible
 * to this script — asserted against, never printed.
 */
function createMailbox() {
  const delivered: Array<{ to: string; resetUrl: string; expiresInMinutes: number }> = [];
  const mailer: PasswordResetMailer = async (params) => {
    delivered.push(params);
  };
  return {
    mailer,
    delivered,
    latest: () => delivered[delivered.length - 1] ?? null,
    clear: () => {
      delivered.length = 0;
    },
  };
}

/** Pulls the raw token back out of a captured link. */
function tokenFromUrl(resetUrl: string): string {
  return new URL(resetUrl).searchParams.get("token") ?? "";
}

interface Fixture {
  tenantId: string;
  userId: string;
  email: string;
}

async function createUser(options: {
  label: string;
  tenantStatus?: TenantStatus;
  accountStatus?: UserAccountStatus;
  isPlatform?: boolean;
}): Promise<Fixture> {
  const email = `verify-pwreset-${options.label}-${RUN}@example.test`;

  const tenant = await prisma.tenant.create({
    data: {
      businessName: `PwReset ${options.label} ${RUN}`,
      email,
      slug: `${SLUG_PREFIX}-${options.label}`,
      status: options.tenantStatus ?? "ACTIVE",
      emailVerifiedAt: new Date(),
      isPlatform: options.isPlatform ?? false,
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `PwReset ${options.label}`,
      email,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: options.accountStatus ?? "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, userId: user.id, email };
}

const META = { ip: "203.0.113.9", userAgent: "verify-password-reset" };

function deps(mailer: PasswordResetMailer, now?: Date) {
  return { prisma, sendEmail: mailer, ...(now ? { now } : {}) };
}

/** Clears every bucket for a subject so one case cannot throttle the next. */
async function clearLimits(subjects: string[]): Promise<void> {
  const limiter = createDatabaseRateLimiter(prisma);
  for (const subject of subjects) {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      await limiter.reset({ policy, subject });
    }
  }
}

async function passwordIs(userId: string, plaintext: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return row?.passwordHash ? bcrypt.compare(plaintext, row.passwordHash) : false;
}

async function main(): Promise<void> {
  await ensurePlatformTenant(prisma);
  const mailbox = createMailbox();

  // -------------------------------------------------------------------------
  console.log("\nAn unregistered address is reported as such");
  // -------------------------------------------------------------------------
  await clearLimits([META.ip]);
  const unknown = await requestPasswordReset(deps(mailbox.mailer), {
    email: `no-such-user-${RUN}@example.test`,
    ...META,
  });
  check("outcome is unknown-account", unknown.outcome === "unknown-account", unknown);
  check("nothing was mailed", mailbox.delivered.length === 0);
  mailbox.clear();

  // -------------------------------------------------------------------------
  console.log("\nA registered address gets a link, and only its digest is stored");
  // -------------------------------------------------------------------------
  const active = await createUser({ label: "active" });
  await clearLimits([META.ip, active.email]);

  const sent = await requestPasswordReset(deps(mailbox.mailer), {
    email: active.email,
    ...META,
  });
  check("outcome is sent", sent.outcome === "sent", sent);
  check("message is the neutral one", sent.message === RESET_REQUESTED_MESSAGE);
  check("exactly one mail was captured", mailbox.delivered.length === 1);

  const firstLink = mailbox.latest();
  const firstToken = firstLink ? tokenFromUrl(firstLink.resetUrl) : "";
  check("the link points at the page, not an API route", Boolean(firstLink?.resetUrl.includes("/reset-password?token=")));
  check("the link's TTL matches the constant", firstLink?.expiresInMinutes === RESET_LINK_TTL_MINUTES);
  check("buildPasswordResetUrl agrees with what was mailed", buildPasswordResetUrl(firstToken) === firstLink?.resetUrl);
  check("the raw token is 64 hex characters", /^[0-9a-f]{64}$/.test(firstToken));

  const rawInDb = await prisma.verificationToken.findFirst({ where: { token: firstToken } });
  check("the RAW token is not in the database", rawInDb === null);
  const digestInDb = await prisma.verificationToken.findUnique({
    where: { token: hashToken(firstToken) },
    select: { purpose: true, identifier: true },
  });
  check("its digest is, under the PASSWORD_RESET purpose", digestInDb?.purpose === VERIFICATION_PURPOSES.PASSWORD_RESET, digestInDb);
  check("stored against the user's address", digestInDb?.identifier === active.email);
  check("isPasswordResetTokenLive says it is live", await isPasswordResetTokenLive(prisma, firstToken));
  mailbox.clear();

  // -------------------------------------------------------------------------
  console.log("\nA second request invalidates the first link");
  // -------------------------------------------------------------------------
  await clearLimits([META.ip, active.email]);
  await requestPasswordReset(deps(mailbox.mailer), { email: active.email, ...META });
  const secondToken = tokenFromUrl(mailbox.latest()?.resetUrl ?? "http://x/?token=");
  check("the two links differ", secondToken !== firstToken);
  check("the first is no longer live", !(await isPasswordResetTokenLive(prisma, firstToken)));
  check("the second is", await isPasswordResetTokenLive(prisma, secondToken));

  const deadRedeem = await confirmPasswordReset(deps(mailbox.mailer), {
    token: firstToken,
    password: NEW_PASSWORD,
    ...META,
  });
  check("redeeming the superseded link is refused", deadRedeem.outcome === "invalid-link", deadRedeem);
  check("the password is unchanged by that attempt", await passwordIs(active.userId, OLD_PASSWORD));
  mailbox.clear();

  // -------------------------------------------------------------------------
  console.log("\nRedeeming the live link changes the password and ends every session");
  // -------------------------------------------------------------------------
  const sidA = await createAppSession(prisma, {
    userId: active.userId,
    tenantId: active.tenantId,
    rememberMe: false,
    ip: META.ip,
    userAgent: META.userAgent,
  });
  const sidB = await createAppSession(prisma, {
    userId: active.userId,
    tenantId: active.tenantId,
    rememberMe: true,
    ip: META.ip,
    userAgent: META.userAgent,
  });

  const changed = await confirmPasswordReset(deps(mailbox.mailer), {
    token: secondToken,
    password: NEW_PASSWORD,
    ...META,
  });
  check("outcome is changed", changed.outcome === "changed", changed);
  check("the new password verifies", await passwordIs(active.userId, NEW_PASSWORD));
  check("the old one no longer does", !(await passwordIs(active.userId, OLD_PASSWORD)));

  const live = await prisma.appSession.count({
    where: { id: { in: [sidA, sidB] }, revokedAt: null },
  });
  check("both live sessions were revoked", live === 0, `${live} still live`);

  const reused = await confirmPasswordReset(deps(mailbox.mailer), {
    token: secondToken,
    password: "another-long-password",
    ...META,
  });
  check("the same link cannot be redeemed twice", reused.outcome === "invalid-link", reused);
  check("the second redemption changed nothing", await passwordIs(active.userId, NEW_PASSWORD));

  // -------------------------------------------------------------------------
  console.log("\nAn expired link is refused");
  // -------------------------------------------------------------------------
  await clearLimits([META.ip, active.email]);
  mailbox.clear();
  const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await requestPasswordReset(deps(mailbox.mailer, longAgo), { email: active.email, ...META });
  const staleToken = tokenFromUrl(mailbox.latest()?.resetUrl ?? "http://x/?token=");
  check("an expired link is not live", !(await isPasswordResetTokenLive(prisma, staleToken)));
  const expired = await confirmPasswordReset(deps(mailbox.mailer), {
    token: staleToken,
    password: "yet-another-long-password",
    ...META,
  });
  check("redeeming it is refused", expired.outcome === "invalid-link", expired);
  const staleRow = await prisma.verificationToken.findUnique({
    where: { token: hashToken(staleToken) },
  });
  check("and the row is destroyed on refusal", staleRow === null);

  // -------------------------------------------------------------------------
  console.log("\nThe purpose discriminator holds in both directions");
  // -------------------------------------------------------------------------
  await clearLimits([META.ip, active.email]);
  mailbox.clear();

  const verifyToken = await issueVerificationToken(
    prisma,
    active.email,
    VERIFICATION_PURPOSES.USER_EMAIL,
  );
  const crossed = await confirmPasswordReset(deps(mailbox.mailer), {
    token: verifyToken.token,
    password: "cross-purpose-password",
    ...META,
  });
  check("a USER_EMAIL token cannot be redeemed as a reset", crossed.outcome === "invalid-link", crossed);
  const survivor = await prisma.verificationToken.findUnique({
    where: { token: verifyToken.tokenHash },
  });
  check("and a wrong-purpose token is NOT destroyed by the attempt", survivor !== null);

  await requestPasswordReset(deps(mailbox.mailer), { email: active.email, ...META });
  const resetToken = tokenFromUrl(mailbox.latest()?.resetUrl ?? "http://x/?token=");
  const asVerification = await consumeVerificationToken(
    prisma,
    resetToken,
    VERIFICATION_PURPOSES.USER_EMAIL,
  );
  check("a reset token cannot be redeemed as a verification", asVerification.status === "invalid", asVerification);
  check("the reset token survives that attempt", await isPasswordResetTokenLive(prisma, resetToken));

  // -------------------------------------------------------------------------
  console.log("\nEligibility: who may reset, and what the refused are told");
  // -------------------------------------------------------------------------
  const suspended = await createUser({ label: "susp", accountStatus: "SUSPENDED" });
  await clearLimits([META.ip, suspended.email]);
  mailbox.clear();
  const suspendedResult = await requestPasswordReset(deps(mailbox.mailer), {
    email: suspended.email,
    ...META,
  });
  check("a suspended user may still reset", suspendedResult.outcome === "sent", suspendedResult);
  check("and is actually sent a link", mailbox.delivered.length === 1);

  const platform = await createUser({ label: "plat", isPlatform: true });
  await clearLimits([META.ip, platform.email]);
  mailbox.clear();
  const platformResult = await requestPasswordReset(deps(mailbox.mailer), {
    email: platform.email,
    ...META,
  });
  check("the platform tenant is refused", platformResult.outcome === "sent", platformResult);
  check("with the SAME message a real send gets", platformResult.message === RESET_REQUESTED_MESSAGE);
  check("and nothing is mailed", mailbox.delivered.length === 0);

  // `users.password_hash` is NOT NULL in the schema, so "a user with no
  // password" is unrepresentable and cannot be fixtured here. The guard for it
  // in isResettable() mirrors the identical defensive check in src/lib/auth.ts
  // and would only matter if that column were ever made nullable.

  // -------------------------------------------------------------------------
  console.log("\nThe per-address rate limit refuses the fourth request in a window");
  // -------------------------------------------------------------------------
  const limited = await createUser({ label: "rl" });
  await clearLimits([META.ip, limited.email]);
  mailbox.clear();

  let refusedAt = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await requestPasswordReset(deps(mailbox.mailer), { email: limited.email, ...META });
    } catch (error: unknown) {
      if (error instanceof RateLimitError) {
        refusedAt = attempt;
        break;
      }
      throw error;
    }
  }
  check(
    `refused on attempt ${RATE_LIMIT_POLICIES.passwordResetByEmail.maxCount + 1}`,
    refusedAt === RATE_LIMIT_POLICIES.passwordResetByEmail.maxCount + 1,
    `refused at ${refusedAt}`,
  );
  check("a throttled request was audited", (await prisma.auditLog.count({
    where: { action: "PASSWORD_RESET_RATE_LIMITED" },
  })) > 0);

  // -------------------------------------------------------------------------
  console.log("\nThe audit trail records the flow, and no secret");
  // -------------------------------------------------------------------------
  const completed = await prisma.auditLog.findFirst({
    where: { action: "PASSWORD_RESET_COMPLETED", actorUserId: active.userId },
    select: { targetId: true, afterValue: true },
  });
  check("a completion row exists for the user", completed?.targetId === active.userId, completed);
  const serialised = JSON.stringify(completed?.afterValue ?? {});
  check("and carries no token", !serialised.includes(firstToken) && !serialised.includes(secondToken));
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    select: { id: true, email: true },
  });
  const tenantIds = tenants.map((tenant) => tenant.id);
  if (tenantIds.length === 0) {
    return;
  }

  const users = await prisma.user.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { id: true, email: true },
  });
  const userIds = users.map((user) => user.id);
  const addresses = [...users.map((u) => u.email), ...tenants.map((t) => t.email)];

  await prisma.verificationToken.deleteMany({ where: { identifier: { in: addresses } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.appSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await clearLimits([META.ip, ...addresses]);
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nVerification threw:", error);
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();

    console.log(
      failures === 0
        ? "\nPassword-reset verification: all checks passed."
        : `\nPassword-reset verification: ${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
