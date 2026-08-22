/**
 * Stage-5 verification — the authentication UI wired to the Stage-4 backend.
 *
 *     npm run verify:stage5
 *
 * Stage 5 added no domain logic. It added a second tab on the login screen, a
 * resend countdown, safe session-ended copy, and one honest checkbox. So this
 * script deliberately does NOT re-prove Stage 4: `npm run verify:stage4` already
 * covers issuing, hashing, expiry, attempt exhaustion, cooldown, enumeration
 * invariance and revocation across 76 checks, and duplicating them here would
 * only mean two places to update. What it proves is the seam Stage 5 created:
 *
 *   - "Remember me" on the PASSWORD form now reaches app_sessions.expires_at,
 *     picking 30 days when ticked and 12 hours when not — the behaviour the
 *     checkbox has been claiming since it was drawn;
 *   - ticking it changes the session and nothing else: the password still has to
 *     be right, and a login code's own 10-minute life is untouched;
 *   - the login-code path still issues, verifies once, and honours rememberMe
 *     the same way;
 *   - signing out revokes the current session, revoke-all revokes every one, and
 *     a revoked session is refused an actor context afterwards;
 *   - a suspended account cannot keep working through a session that was live
 *     when the suspension landed.
 *
 * WHAT IS CHECKED AT SOURCE LEVEL, AND WHY IT IS SAID OUT LOUD. Auth.js does not
 * export a provider's `authorize`, and driving one needs a CSRF token and a real
 * HTTP request, so this script cannot call the password provider directly. Two
 * things are therefore asserted against the text of src/lib/auth.ts instead of
 * by execution: that the credentials schema accepts `rememberMe`, and that it is
 * forwarded into createAppSession. Everything downstream of that call IS
 * executed. The manual test steps in the Stage 5 report cover the browser half.
 *
 * NO REAL MAIL IS EVER SENT — the mailer is injected as a capture function, and
 * the captured code is asserted against, never printed.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import {
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  requestLoginCode,
  verifyLoginCode,
  type LoginCodeMailer,
} from "@/lib/loginCode";
import {
  REMEMBER_ME_TTL_MS,
  SESSION_TTL_MS,
  computeSessionExpiry,
} from "@/lib/sessionPolicy";
import {
  createAppSession,
  revokeAllSessionsForUser,
  revokeSession,
} from "@/lib/appSession";
import { loadLiveSession, toTenantActor, UnauthenticatedError } from "@/lib/session";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { getSessionEndedMessage } from "@/lib/sessionEndedMessage";
import { describeRequestOutcome, sanitiseCodeInput } from "@/components/auth/loginCodeState";
import type { TenantStatus, UserAccountStatus } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const TEST_PEPPER = "verify-stage5-pepper";
const PASSWORD = "Stage5-verify-password";

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
const TENANT_SLUG = `verify-stage5-${RUN}`;

/** Captures what would have been mailed. Asserted against, never printed. */
function createMailbox() {
  const delivered: Array<{ to: string; code: string; expiresInMinutes: number }> = [];
  const mailer: LoginCodeMailer = async (params) => {
    delivered.push(params);
  };
  return {
    mailer,
    latest: () => delivered[delivered.length - 1] ?? null,
    count: () => delivered.length,
  };
}

function deps(mailer: LoginCodeMailer, now?: Date) {
  return {
    prisma,
    sendEmail: mailer,
    pepper: TEST_PEPPER,
    // The 400ms enumeration floor is real behaviour, but sleeping it on every
    // call would add seconds to the run for nothing.
    padTiming: false,
    ...(now ? { now } : {}),
  };
}

/**
 * The service records the caller's IP and user agent on the rows it writes.
 * There is no HTTP request here, and inventing one would put fiction in the
 * audit trail, so both are explicitly null.
 */
const NO_REQUEST_META = { ip: null, userAgent: null } as const;

interface Fixture {
  tenantId: string;
  userId: string;
  email: string;
}

async function createUser(options: {
  label: string;
  tenantStatus?: TenantStatus;
  accountStatus?: UserAccountStatus;
}): Promise<Fixture> {
  const email = `verify-stage5-${options.label}-${RUN}@example.test`;

  const tenant = await prisma.tenant.create({
    data: {
      businessName: `Stage5 ${options.label} ${RUN}`,
      email,
      slug: `${TENANT_SLUG}-${options.label}`,
      status: options.tenantStatus ?? "ACTIVE",
      emailVerifiedAt: new Date(),
      isPlatform: false,
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Stage5 ${options.label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: options.accountStatus ?? "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, userId: user.id, email };
}

/** Milliseconds between two dates, tolerant of the clock drift of a round trip. */
function isApproximately(actualMs: number, expectedMs: number, toleranceMs = 60_000): boolean {
  return Math.abs(actualMs - expectedMs) <= toleranceMs;
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  console.log("\nThe password provider forwards rememberMe (source-level)");
  // -------------------------------------------------------------------------
  // Not executable from here — see the header. Asserted against the file so a
  // future edit that silently drops the wiring is caught by this run rather
  // than by a user whose 30-day session lasts twelve hours.
  const authSource = readFileSync("src/lib/auth.ts", "utf8");

  check(
    "the credentials schema declares rememberMe",
    /credentialsSchema = z\.object\(\{[\s\S]*?rememberMe:/.test(authSource),
  );
  check(
    "the password authorize destructures rememberMe",
    /const \{ email, password, rememberMe \} = parsed\.data;/.test(authSource),
  );
  check(
    "the password authorize passes rememberMe to createAppSession",
    /createAppSession\(prisma, \{[\s\S]{0,300}?rememberMe,/.test(authSource),
  );
  check(
    "the password provider still verifies with bcrypt.compare",
    /bcrypt\.compare\(password, user\.passwordHash\)/.test(authSource),
  );
  check(
    "rememberMe is not written into the JWT",
    !/token\.rememberMe/.test(authSource) &&
      !/rememberMe/.test(readFileSync("src/lib/auth.config.ts", "utf8")),
  );

  const active = await createUser({ label: "active" });

  // -------------------------------------------------------------------------
  console.log("\nPassword login still works, unchanged");
  // -------------------------------------------------------------------------
  const stored = await prisma.user.findUnique({
    where: { id: active.userId },
    select: { passwordHash: true, emailVerifiedAt: true, accountStatus: true },
  });

  check(
    "the right password verifies",
    stored?.passwordHash ? await bcrypt.compare(PASSWORD, stored.passwordHash) : false,
  );
  check(
    "a wrong password does not",
    stored?.passwordHash ? !(await bcrypt.compare("wrong-password", stored.passwordHash)) : false,
  );
  check("the account is active and verified", stored?.accountStatus === "ACTIVE" && stored.emailVerifiedAt !== null);

  // -------------------------------------------------------------------------
  console.log("\nPassword rememberMe reaches the session lifetime");
  // -------------------------------------------------------------------------
  // The exact call the provider makes, with the exact value it now forwards.
  const plainSid = await createAppSession(prisma, {
    userId: active.userId,
    tenantId: active.tenantId,
    rememberMe: false,
  });
  const rememberedSid = await createAppSession(prisma, {
    userId: active.userId,
    tenantId: active.tenantId,
    rememberMe: true,
  });

  const plain = await prisma.appSession.findUniqueOrThrow({
    where: { id: plainSid },
    select: { createdAt: true, expiresAt: true, rememberMe: true },
  });
  const remembered = await prisma.appSession.findUniqueOrThrow({
    where: { id: rememberedSid },
    select: { createdAt: true, expiresAt: true, rememberMe: true },
  });

  check(
    "an unticked box gives the 12-hour session",
    plain.rememberMe === false &&
      isApproximately(plain.expiresAt.getTime() - plain.createdAt.getTime(), SESSION_TTL_MS),
    plain.expiresAt.getTime() - plain.createdAt.getTime(),
  );
  check(
    "a ticked box gives the 30-day session",
    remembered.rememberMe === true &&
      isApproximately(
        remembered.expiresAt.getTime() - remembered.createdAt.getTime(),
        REMEMBER_ME_TTL_MS,
      ),
    remembered.expiresAt.getTime() - remembered.createdAt.getTime(),
  );
  check(
    "the two are genuinely different lifetimes",
    remembered.expiresAt.getTime() > plain.expiresAt.getTime(),
  );
  check(
    "the stored expiry matches the policy helper exactly",
    computeSessionExpiry(plain.createdAt, false).getTime() === plain.expiresAt.getTime() &&
      computeSessionExpiry(remembered.createdAt, true).getTime() === remembered.expiresAt.getTime(),
  );

  // -------------------------------------------------------------------------
  console.log("\nThe login-code path still works, and honours rememberMe the same way");
  // -------------------------------------------------------------------------
  const mailbox = createMailbox();

  const requested = await requestLoginCode(deps(mailbox.mailer), { email: active.email, ...NO_REQUEST_META });
  check("a code is issued and acknowledged generically", requested.message.length > 0);
  check("exactly one mail would have been sent", mailbox.count() === 1);

  const issued = mailbox.latest();
  const issuedRow = await prisma.loginCode.findFirstOrThrow({
    where: { userId: active.userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, createdAt: true, expiresAt: true },
  });

  check(
    "the stored value is not the code",
    issued !== null && issuedRow.codeHash !== issued.code && !issuedRow.codeHash.includes(issued.code),
  );

  const codeLifetimeWithoutRemember = issuedRow.expiresAt.getTime() - issuedRow.createdAt.getTime();
  check(
    "the code lives ten minutes",
    isApproximately(codeLifetimeWithoutRemember, CODE_TTL_MS, 5_000),
    codeLifetimeWithoutRemember,
  );

  const verifiedPlain = await verifyLoginCode(deps(mailbox.mailer), {
    email: active.email,
    code: issued!.code,
    rememberMe: false,
    ...NO_REQUEST_META,
  });
  check("the code signs the user in", verifiedPlain?.id === active.userId);

  const codeSessionPlain = await prisma.appSession.findUniqueOrThrow({
    where: { id: verifiedPlain!.sid },
    select: { createdAt: true, expiresAt: true, rememberMe: true },
  });
  check(
    "without rememberMe the code session is 12 hours",
    codeSessionPlain.rememberMe === false &&
      isApproximately(
        codeSessionPlain.expiresAt.getTime() - codeSessionPlain.createdAt.getTime(),
        SESSION_TTL_MS,
      ),
  );

  check(
    "the code is spent and cannot be replayed",
    (await verifyLoginCode(deps(mailbox.mailer), {
      email: active.email,
      code: issued!.code,
      rememberMe: false,
      ...NO_REQUEST_META,
    })) === null,
  );

  // A second code, this time with the box ticked. The clock is pushed past the
  // resend cooldown rather than slept through: the cooldown is Stage 4's and is
  // verified there, and waiting a real minute here would buy nothing.
  const afterCooldown = new Date(Date.now() + RESEND_COOLDOWN_MS + 1_000);
  await requestLoginCode(deps(mailbox.mailer, afterCooldown), { email: active.email, ...NO_REQUEST_META });
  const rememberedIssued = mailbox.latest();
  const rememberedRow = await prisma.loginCode.findFirstOrThrow({
    where: { userId: active.userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, expiresAt: true },
  });

  const codeLifetimeWithRemember =
    rememberedRow.expiresAt.getTime() - rememberedRow.createdAt.getTime();
  check(
    "rememberMe does not extend the CODE's own life",
    codeLifetimeWithRemember === codeLifetimeWithoutRemember,
    { codeLifetimeWithoutRemember, codeLifetimeWithRemember },
  );

  const verifiedRemembered = await verifyLoginCode(deps(mailbox.mailer, afterCooldown), {
    email: active.email,
    code: rememberedIssued!.code,
    rememberMe: true,
    ...NO_REQUEST_META,
  });
  check("the second code signs the user in", verifiedRemembered?.id === active.userId);

  const codeSessionRemembered = await prisma.appSession.findUniqueOrThrow({
    where: { id: verifiedRemembered!.sid },
    select: { createdAt: true, expiresAt: true, rememberMe: true },
  });
  check(
    "with rememberMe the code session is 30 days",
    codeSessionRemembered.rememberMe === true &&
      isApproximately(
        codeSessionRemembered.expiresAt.getTime() - codeSessionRemembered.createdAt.getTime(),
        REMEMBER_ME_TTL_MS,
      ),
  );

  // -------------------------------------------------------------------------
  console.log("\nSigning out revokes the session behind the cookie");
  // -------------------------------------------------------------------------
  // What POST /api/auth/sessions/revoke does, which is what SignOutButton calls
  // before it clears the cookie.
  const signOutSid = verifiedRemembered!.sid;
  check(
    "the session is live before sign-out",
    (await loadLiveSession(signOutSid, active.userId)).context !== null,
  );

  check(
    "revoking reports that it revoked something",
    await revokeSession(prisma, {
      sessionId: signOutSid,
      revokedById: active.userId,
      reason: "Signed out",
    }),
  );
  check(
    "the session is dead immediately afterwards",
    (await loadLiveSession(signOutSid, active.userId)).context === null,
  );
  check(
    "revoking twice is a no-op rather than a second revocation",
    (await revokeSession(prisma, { sessionId: signOutSid, revokedById: active.userId })) === false,
  );

  let refusedAfterSignOut = false;
  try {
    toTenantActor(await loadLiveSession(signOutSid, active.userId));
  } catch (error: unknown) {
    refusedAfterSignOut = error instanceof UnauthenticatedError;
  }
  check("a signed-out session is refused an actor context", refusedAfterSignOut);

  // -------------------------------------------------------------------------
  console.log("\nRevoke-all still ends every device");
  // -------------------------------------------------------------------------
  const deviceSids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    deviceSids.push(
      await createAppSession(prisma, {
        userId: active.userId,
        tenantId: active.tenantId,
        rememberMe: index === 0,
      }),
    );
  }

  const revokedCount = await revokeAllSessionsForUser(prisma, {
    userId: active.userId,
    revokedById: active.userId,
    reason: "Signed out of all devices",
  });
  check("revoke-all reports the live ones it ended", revokedCount >= 3, revokedCount);

  for (const [index, sid] of deviceSids.entries()) {
    check(
      `device ${index} is signed out`,
      (await loadLiveSession(sid, active.userId)).context === null,
    );
  }
  check(
    "no live session remains for the user",
    (await prisma.appSession.count({ where: { userId: active.userId, revokedAt: null } })) === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nA suspension ends a session that was already live");
  // -------------------------------------------------------------------------
  const suspendable = await createUser({ label: "suspendable" });
  const suspendableSid = await createAppSession(prisma, {
    userId: suspendable.userId,
    tenantId: suspendable.tenantId,
    rememberMe: true,
  });

  check(
    "the session works while the account is active",
    toTenantActor(await loadLiveSession(suspendableSid, suspendable.userId)).userId ===
      suspendable.userId,
  );

  await prisma.user.update({
    where: { id: suspendable.userId },
    data: { accountStatus: "SUSPENDED" },
  });

  // The session row itself is untouched — the refusal comes from the live
  // status columns, which is the point of reading them on every request rather
  // than trusting a 30-day-old token.
  let refusedAfterSuspension = false;
  try {
    toTenantActor(await loadLiveSession(suspendableSid, suspendable.userId));
  } catch {
    refusedAfterSuspension = true;
  }
  check("a suspended account cannot continue through its live session", refusedAfterSuspension);

  const suspendedMailbox = createMailbox();
  await requestLoginCode(deps(suspendedMailbox.mailer), { email: suspendable.email, ...NO_REQUEST_META });
  check("no code is mailed to a suspended account", suspendedMailbox.count() === 0);

  // -------------------------------------------------------------------------
  console.log("\nThe UI helpers behave as the screen depends on");
  // -------------------------------------------------------------------------
  // Exhaustively unit-tested in tests/unit; repeated here only for the handful
  // of invariants a security review would want confirmed against the built app.
  check(
    "a pasted code is normalised to six digits",
    sanitiseCodeInput("Your code is 123 456\n") === "123456",
  );
  check(
    "the request outcome is derived from the status alone",
    describeRequestOutcome(200).advance && !describeRequestOutcome(429).advance,
  );
  check(
    "session-ended copy never names a suspension",
    !getSessionEndedMessage(new URLSearchParams("ended=1&reason=account-suspended"))!
      .toLowerCase()
      .includes("suspend"),
  );
  check(
    "an unknown reason is not echoed into the page",
    getSessionEndedMessage(new URLSearchParams("ended=1&reason=<script>")) ===
      getSessionEndedMessage(new URLSearchParams("ended=1")),
  );
  check(
    "a reason without ended=1 shows nothing, matching middleware",
    getSessionEndedMessage(new URLSearchParams("reason=expired")) === null,
  );
}

/**
 * Removes this run's fixtures — and then CHECKS that it did.
 *
 * A fixture tenant left behind is an ACTIVE tenant with no plan and no
 * account-wide role holder, which is exactly what `npm run stage1:verify`
 * asserts against, so a silent leak here surfaces later as unexplained failures
 * in a different script. A leak now reports itself, against the run that caused
 * it. (This happened once during Stage 4 development.)
 */
async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: TENANT_SLUG } },
    select: { id: true },
  });
  const tenantIds = tenants.map((tenant) => tenant.id);

  if (tenantIds.length === 0) {
    return;
  }

  const users = await prisma.user.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  // AuditLog holds RESTRICT foreign keys onto both actors, so its rows go first
  // or nothing behind them can be deleted at all.
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { actorTenantId: { in: tenantIds } }] },
  });
  await prisma.loginCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.appSession.deleteMany({ where: { userId: { in: userIds } } });
  // Every bucket, not just this run's: the keys are digests, so there is no way
  // to select "mine", and locally there is nothing worth preserving.
  await prisma.rateLimitBucket.deleteMany({});
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  const residue = await prisma.tenant.findMany({
    where: { slug: { startsWith: TENANT_SLUG } },
    select: { slug: true },
  });

  if (residue.length > 0) {
    failures += 1;
    console.log(
      `  FAIL  cleanup left ${residue.length} fixture tenant(s) behind — these will break stage1:verify`,
      residue.map((tenant) => tenant.slug),
    );
  }
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
        ? "\nStage 5 verification: all checks passed."
        : `\nStage 5 verification: ${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
