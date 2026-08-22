/**
 * Stage-4 verification — six-digit login codes, remember-me sessions, and
 * server-side session revocation. Exercised against a LOCAL database.
 *
 *     npm run verify:stage4
 *
 * What it proves, against the real modules rather than reimplementations:
 *
 *   - an eligible user can request a code, and a row is written whose stored
 *     hash is neither the code nor derivable from the table alone;
 *   - a code verifies exactly once, creates an AppSession through the existing
 *     registry, and stamps lastLoginAt;
 *   - rememberMe picks the 30-day expiry and its absence picks the 12-hour one,
 *     while the CODE's own lifetime is unaffected either way;
 *   - expired, reused and wrong codes are all refused, and the fifth wrong guess
 *     exhausts the code even if the sixth guess is correct;
 *   - issuing a new code invalidates the previous one;
 *   - the resend cooldown suppresses a second code without saying so;
 *   - unknown, pending, suspended and rejected accounts get the byte-identical
 *     generic response and no session;
 *   - a code issued while active does not open a session after suspension;
 *   - revoking the current session ends access, and revoke-all ends every other
 *     device's too;
 *   - password login still works, unchanged.
 *
 * NO REAL MAIL IS EVER SENT. The mailer is injected as a capture function, which
 * is also how the script learns the code at all — nothing reads it from the
 * database, because nothing can.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { prisma } from "@/lib/prisma";
import {
  CODE_TTL_MS,
  GENERIC_LOGIN_CODE_MESSAGE,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  hashLoginCode,
  requestLoginCode,
  verifyLoginCode,
  type LoginCodeMailer,
} from "@/lib/loginCode";
import { RATE_LIMIT_POLICIES, createDatabaseRateLimiter } from "@/lib/rateLimit";
import { REMEMBER_ME_TTL_MS, SESSION_TTL_MS } from "@/lib/sessionPolicy";
import { loadLiveSession, toTenantActor, UnauthenticatedError } from "@/lib/session";
import { revokeAllSessionsForUser, revokeSession } from "@/lib/appSession";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { ensurePlatformTenant } from "@/lib/platform/tenant";
import type { MembershipStatus, TenantStatus, UserAccountStatus } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const TEST_PEPPER = "verify-stage4-pepper";

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
const TENANT_SLUG = `verify-stage4-${RUN}`;
const PASSWORD_HASH = "$2b$12$OJ3jFv9KOzjVHbBcdZHbnek5c4VLp0Mt61tWkWe5kFNRaUQfA5j9q";

/**
 * Captures what would have been mailed. The ONLY place the plaintext code is
 * visible to this script — asserted against, never printed.
 */
function createMailbox() {
  const delivered: Array<{ to: string; code: string; expiresInMinutes: number }> = [];
  const mailer: LoginCodeMailer = async (params) => {
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

/** Deps every call shares: captured mail, fixed pepper, no artificial padding. */
function deps(mailer: LoginCodeMailer, now?: Date) {
  return {
    prisma,
    sendEmail: mailer,
    pepper: TEST_PEPPER,
    // The 400ms enumeration floor is real behaviour, but sleeping it on every
    // one of ~30 calls would add ten seconds to the run for nothing.
    padTiming: false,
    ...(now ? { now } : {}),
  };
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
  membershipStatus?: MembershipStatus;
  emailVerified?: boolean;
  isPlatform?: boolean;
}): Promise<Fixture> {
  const email = `verify-stage4-${options.label}-${RUN}@example.test`;

  const tenant = await prisma.tenant.create({
    data: {
      businessName: `Stage4 ${options.label} ${RUN}`,
      email,
      slug: `${TENANT_SLUG}-${options.label}`,
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
      name: `Stage4 ${options.label}`,
      email,
      passwordHash: PASSWORD_HASH,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
      accountStatus: options.accountStatus ?? "ACTIVE",
      membershipStatus: options.membershipStatus ?? "ACTIVE",
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, userId: user.id, email };
}

/** Clears the four buckets for a subject so one case cannot throttle the next. */
async function clearLimits(subjects: string[]): Promise<void> {
  const limiter = createDatabaseRateLimiter(prisma);
  for (const subject of subjects) {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      await limiter.reset({ policy, subject });
    }
  }
}

async function main(): Promise<void> {
  await ensurePlatformTenant(prisma);

  const mailbox = createMailbox();

  // -------------------------------------------------------------------------
  console.log("\nRequesting a code for an eligible user");
  // -------------------------------------------------------------------------
  const active = await createUser({ label: "active" });
  await clearLimits([active.email, "127.0.0.1"]);

  const firstResponse = await requestLoginCode(deps(mailbox.mailer), {
    email: active.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check(
    "request returns the generic acknowledgement",
    firstResponse.message === GENERIC_LOGIN_CODE_MESSAGE,
    firstResponse.message,
  );
  check("a code was handed to the mailer", mailbox.delivered.length === 1);
  check(
    "the mailed code is six digits",
    /^[0-9]{6}$/.test(mailbox.latest()?.code ?? ""),
  );
  check(
    "the mail states the ten-minute expiry",
    mailbox.latest()?.expiresInMinutes === Math.round(CODE_TTL_MS / 60_000),
  );

  const issuedCode = mailbox.latest()!.code;

  const storedRow = await prisma.loginCode.findFirst({
    where: { userId: active.userId },
    orderBy: { createdAt: "desc" },
  });

  check("a LoginCode row was written", storedRow !== null);
  check("the row is unconsumed", storedRow?.consumedAt === null);
  check("the row starts with zero attempts", storedRow?.attemptCount === 0);
  check(
    "the plaintext code is NOT stored",
    storedRow?.codeHash !== issuedCode && !storedRow?.codeHash.includes(issuedCode),
  );
  check(
    "the stored value is a 64-character HMAC digest",
    /^[0-9a-f]{64}$/.test(storedRow?.codeHash ?? ""),
  );
  check(
    "the digest is unreproducible without the pepper",
    hashLoginCode({
      pepper: "wrong-pepper",
      userId: active.userId,
      challengeId: storedRow!.id,
      code: issuedCode,
    }) !== storedRow?.codeHash,
  );
  check(
    "the digest IS reproducible with it, so verification can work at all",
    hashLoginCode({
      pepper: TEST_PEPPER,
      userId: active.userId,
      challengeId: storedRow!.id,
      code: issuedCode,
    }) === storedRow?.codeHash,
  );
  check(
    "an audit row records the issue without naming the code",
    (await prisma.auditLog.count({
      where: { action: "LOGIN_CODE_REQUESTED", targetId: storedRow!.id },
    })) === 1,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe resend cooldown");
  // -------------------------------------------------------------------------
  mailbox.clear();
  const cooledResponse = await requestLoginCode(deps(mailbox.mailer), {
    email: active.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check(
    "a second immediate request says exactly the same thing",
    cooledResponse.message === GENERIC_LOGIN_CODE_MESSAGE,
  );
  check("but no second code is mailed", mailbox.delivered.length === 0);
  check(
    "and no second row is written",
    (await prisma.loginCode.count({ where: { userId: active.userId } })) === 1,
  );
  check("the cooldown is one minute", RESEND_COOLDOWN_MS === 60_000);

  // -------------------------------------------------------------------------
  console.log("\nWrong codes and the attempt limit");
  // -------------------------------------------------------------------------
  await clearLimits([active.email, "127.0.0.1"]);
  const wrongCode = issuedCode === "111111" ? "222222" : "111111";

  const firstWrong = await verifyLoginCode(deps(mailbox.mailer), {
    email: active.email,
    code: wrongCode,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check("a wrong code is refused", firstWrong === null);
  check(
    "and it spends an attempt",
    (await prisma.loginCode.findUnique({ where: { id: storedRow!.id } }))?.attemptCount === 1,
  );

  for (let attempt = 2; attempt <= MAX_VERIFY_ATTEMPTS; attempt += 1) {
    await verifyLoginCode(deps(mailbox.mailer), {
      email: active.email,
      code: wrongCode,
      rememberMe: false,
      ip: "127.0.0.1",
      userAgent: "verify-stage4",
    });
  }

  const exhausted = await prisma.loginCode.findUnique({ where: { id: storedRow!.id } });
  check(
    `the code stops counting at ${MAX_VERIFY_ATTEMPTS} attempts`,
    exhausted?.attemptCount === MAX_VERIFY_ATTEMPTS,
    exhausted?.attemptCount,
  );

  const correctAfterLockout = await verifyLoginCode(deps(mailbox.mailer), {
    email: active.email,
    code: issuedCode,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check(
    "the CORRECT code is refused once attempts are exhausted",
    correctAfterLockout === null,
  );
  check(
    "and no session was created by any of it",
    (await prisma.appSession.count({ where: { userId: active.userId } })) === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nA new code invalidates the previous one");
  // -------------------------------------------------------------------------
  await clearLimits([active.email, "127.0.0.1"]);
  mailbox.clear();

  // Past the cooldown by moving the clock, not by sleeping for a minute.
  const later = new Date(Date.now() + RESEND_COOLDOWN_MS + 1_000);
  await requestLoginCode(deps(mailbox.mailer, later), {
    email: active.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  const secondCode = mailbox.latest()!.code;
  const secondRow = await prisma.loginCode.findFirst({
    where: { userId: active.userId },
    orderBy: { createdAt: "desc" },
  });

  check("a fresh code is issued after the cooldown", secondRow?.id !== storedRow?.id);
  check(
    "the previous row is now consumed, so only one code is ever live",
    (await prisma.loginCode.findUnique({ where: { id: storedRow!.id } }))?.consumedAt !== null,
  );

  const staleAttempt = await verifyLoginCode(deps(mailbox.mailer, later), {
    email: active.email,
    code: issuedCode,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });
  check("the superseded code no longer verifies", staleAttempt === null);

  // -------------------------------------------------------------------------
  console.log("\nSuccessful verification without remember-me");
  // -------------------------------------------------------------------------
  await clearLimits([active.email, "127.0.0.1"]);
  const verifiedAt = new Date(later.getTime() + 1_000);

  const success = await verifyLoginCode(deps(mailbox.mailer, verifiedAt), {
    email: active.email,
    code: secondCode,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check("the correct code verifies", success !== null);
  check("it returns the user's own tenant", success?.tenantId === active.tenantId);
  check("it returns a session id for the JWT's sid claim", Boolean(success?.sid));

  const session = await prisma.appSession.findUnique({ where: { id: success!.sid } });
  check("an AppSession row exists for it", session !== null);
  check("the session is not remembered", session?.rememberMe === false);
  check(
    "the session expires in twelve hours",
    session?.expiresAt.getTime() === verifiedAt.getTime() + SESSION_TTL_MS,
  );
  check(
    "lastLoginAt was stamped",
    (await prisma.user.findUnique({ where: { id: active.userId } }))?.lastLoginAt !== null,
  );
  check(
    "the code is now consumed",
    (await prisma.loginCode.findUnique({ where: { id: secondRow!.id } }))?.consumedAt !== null,
  );
  check(
    "a success is audited against the LoginCode row, not its contents",
    (await prisma.auditLog.count({
      where: { action: "LOGIN_CODE_SUCCEEDED", targetId: secondRow!.id },
    })) === 1,
  );

  // The whole point of the session registry: the session actually authorises.
  const liveActor = toTenantActor(await loadLiveSession(success!.sid, active.userId, verifiedAt));
  check("the new session resolves to a tenant actor", liveActor.userId === active.userId);

  // -------------------------------------------------------------------------
  console.log("\nA consumed code cannot be replayed");
  // -------------------------------------------------------------------------
  await clearLimits([active.email, "127.0.0.1"]);
  const replay = await verifyLoginCode(deps(mailbox.mailer, verifiedAt), {
    email: active.email,
    code: secondCode,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check("the same code cannot be used twice", replay === null);
  check(
    "and no second session came from it",
    (await prisma.appSession.count({ where: { userId: active.userId } })) === 1,
  );

  // -------------------------------------------------------------------------
  console.log("\nRemember-me selects the longer session");
  // -------------------------------------------------------------------------
  await clearLimits([active.email, "127.0.0.1"]);
  mailbox.clear();

  const rememberAt = new Date(verifiedAt.getTime() + RESEND_COOLDOWN_MS + 1_000);
  await requestLoginCode(deps(mailbox.mailer, rememberAt), {
    email: active.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  const rememberedLogin = await verifyLoginCode(deps(mailbox.mailer, rememberAt), {
    email: active.email,
    code: mailbox.latest()!.code,
    rememberMe: true,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  const rememberedSession = await prisma.appSession.findUnique({
    where: { id: rememberedLogin!.sid },
  });

  check("remember-me logs in", rememberedLogin !== null);
  check("the session is flagged remembered", rememberedSession?.rememberMe === true);
  check(
    "and expires in thirty days",
    rememberedSession?.expiresAt.getTime() === rememberAt.getTime() + REMEMBER_ME_TTL_MS,
  );

  const rememberedCodeRow = await prisma.loginCode.findFirst({
    where: { userId: active.userId },
    orderBy: { createdAt: "desc" },
  });
  check(
    "remember-me does NOT extend the code's own lifetime",
    rememberedCodeRow?.expiresAt.getTime() === rememberAt.getTime() + CODE_TTL_MS,
  );

  // -------------------------------------------------------------------------
  console.log("\nAn expired code");
  // -------------------------------------------------------------------------
  const expiring = await createUser({ label: "expiring" });
  await clearLimits([expiring.email, "127.0.0.1"]);
  mailbox.clear();

  const issuedAt = new Date();
  await requestLoginCode(deps(mailbox.mailer, issuedAt), {
    email: expiring.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  const expiredAttempt = await verifyLoginCode(
    // One millisecond past the TTL. Expiry is exclusive, so this is over.
    deps(mailbox.mailer, new Date(issuedAt.getTime() + CODE_TTL_MS + 1)),
    {
      email: expiring.email,
      code: mailbox.latest()!.code,
      rememberMe: false,
      ip: "127.0.0.1",
      userAgent: "verify-stage4",
    },
  );

  check("an expired code is refused", expiredAttempt === null);
  check(
    "and creates no session",
    (await prisma.appSession.count({ where: { userId: expiring.userId } })) === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nIneligible accounts: identical response, no session");
  // -------------------------------------------------------------------------
  const ineligible: Array<[string, Fixture]> = [
    ["pending account", await createUser({ label: "pending", accountStatus: "PENDING" })],
    ["suspended account", await createUser({ label: "suspended", accountStatus: "SUSPENDED" })],
    [
      "rejected membership",
      await createUser({ label: "rejected", membershipStatus: "REJECTED" }),
    ],
    ["suspended tenant", await createUser({ label: "tenant-susp", tenantStatus: "SUSPENDED" })],
    ["pending tenant", await createUser({ label: "tenant-pend", tenantStatus: "PENDING" })],
    ["unverified email", await createUser({ label: "unverified", emailVerified: false })],
    ["platform tenant user", await createUser({ label: "platform", isPlatform: true })],
  ];

  const responses = new Set<string>();

  for (const [label, fixture] of ineligible) {
    await clearLimits([fixture.email, "127.0.0.1"]);
    mailbox.clear();

    const response = await requestLoginCode(deps(mailbox.mailer), {
      email: fixture.email,
      ip: "127.0.0.1",
      userAgent: "verify-stage4",
    });

    responses.add(response.message);
    check(`${label}: no code is mailed`, mailbox.delivered.length === 0);
    check(
      `${label}: no LoginCode row is written`,
      (await prisma.loginCode.count({ where: { userId: fixture.userId } })) === 0,
    );
  }

  // An address that has never existed.
  await clearLimits([`verify-stage4-nobody-${RUN}@example.test`, "127.0.0.1"]);
  mailbox.clear();
  const unknownResponse = await requestLoginCode(deps(mailbox.mailer), {
    email: `verify-stage4-nobody-${RUN}@example.test`,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });
  responses.add(unknownResponse.message);
  check("unknown address: no code is mailed", mailbox.delivered.length === 0);

  responses.add(firstResponse.message);
  check(
    "every branch — eligible, ineligible and unknown — returns ONE identical message",
    responses.size === 1,
    [...responses],
  );

  // -------------------------------------------------------------------------
  console.log("\nA code outlives its eligibility");
  // -------------------------------------------------------------------------
  const revoked = await createUser({ label: "revoked" });
  await clearLimits([revoked.email, "127.0.0.1"]);
  mailbox.clear();

  await requestLoginCode(deps(mailbox.mailer), {
    email: revoked.email,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  // The Owner suspends the account in the ten minutes between mail and entry.
  await prisma.user.update({
    where: { id: revoked.userId },
    data: { accountStatus: "SUSPENDED" },
  });

  const afterSuspension = await verifyLoginCode(deps(mailbox.mailer), {
    email: revoked.email,
    code: mailbox.latest()!.code,
    rememberMe: false,
    ip: "127.0.0.1",
    userAgent: "verify-stage4",
  });

  check(
    "a code issued while active does not log in after suspension",
    afterSuspension === null,
  );
  check(
    "and no session was created",
    (await prisma.appSession.count({ where: { userId: revoked.userId } })) === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nRate limiting");
  // -------------------------------------------------------------------------
  const flooder = await createUser({ label: "flooder" });
  const floodIp = "203.0.113.44";
  await clearLimits([flooder.email, floodIp]);
  mailbox.clear();

  let limited = false;
  let accepted = 0;
  for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.requestByEmail.maxCount + 2; attempt += 1) {
    try {
      await requestLoginCode(deps(mailbox.mailer), {
        email: flooder.email,
        ip: floodIp,
        userAgent: "verify-stage4",
      });
      accepted += 1;
    } catch (error: unknown) {
      limited = (error as Error).name === "RateLimitError";
      break;
    }
  }

  check("repeated requests are eventually throttled", limited);
  check(
    `throttling starts after ${RATE_LIMIT_POLICIES.requestByEmail.maxCount} requests`,
    accepted === RATE_LIMIT_POLICIES.requestByEmail.maxCount,
    accepted,
  );
  check(
    "the stored bucket key contains no email address",
    (await prisma.rateLimitBucket.findMany({ select: { key: true } })).every(
      (row) => !row.key.includes("@"),
    ),
  );
  check(
    "throttling is audited without a subject",
    (await prisma.auditLog.count({ where: { action: "LOGIN_CODE_RATE_LIMITED" } })) > 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nSession revocation");
  // -------------------------------------------------------------------------
  const revokeUser = await createUser({ label: "revoker" });
  const sessionIds: string[] = [];

  for (let device = 0; device < 3; device += 1) {
    await clearLimits([revokeUser.email, "127.0.0.1"]);
    mailbox.clear();
    const at = new Date(Date.now() + device * (RESEND_COOLDOWN_MS + 1_000));

    await requestLoginCode(deps(mailbox.mailer, at), {
      email: revokeUser.email,
      ip: "127.0.0.1",
      userAgent: `verify-stage4-device-${device}`,
    });

    const login = await verifyLoginCode(deps(mailbox.mailer, at), {
      email: revokeUser.email,
      code: mailbox.latest()!.code,
      rememberMe: device === 0,
      ip: "127.0.0.1",
      userAgent: `verify-stage4-device-${device}`,
    });

    sessionIds.push(login!.sid);
  }

  check("three devices signed in", sessionIds.length === 3);

  await revokeSession(prisma, { sessionId: sessionIds[0]!, revokedById: revokeUser.userId });

  const afterSingleRevoke = await loadLiveSession(sessionIds[0]!, revokeUser.userId);
  check("the revoked session no longer resolves", afterSingleRevoke.context === null);
  check("and reports why, server-side only", afterSingleRevoke.reason === "revoked");

  const stillLive = await loadLiveSession(sessionIds[1]!, revokeUser.userId);
  check("the other devices are untouched", stillLive.context !== null);

  const revokedCount = await revokeAllSessionsForUser(prisma, {
    userId: revokeUser.userId,
    revokedById: revokeUser.userId,
    reason: "Signed out of all devices",
  });

  check("revoke-all reports the two that were still live", revokedCount === 2, revokedCount);

  for (const [index, sid] of sessionIds.entries()) {
    const resolved = await loadLiveSession(sid, revokeUser.userId);
    check(`device ${index} is signed out`, resolved.context === null);
  }

  check(
    "no live session remains for the user",
    (await prisma.appSession.count({
      where: { userId: revokeUser.userId, revokedAt: null },
    })) === 0,
  );

  let refusedAfterRevoke = false;
  try {
    toTenantActor(await loadLiveSession(sessionIds[1]!, revokeUser.userId));
  } catch (error: unknown) {
    refusedAfterRevoke = error instanceof UnauthenticatedError;
  }
  check("a revoked session is refused an actor context", refusedAfterRevoke);

  // -------------------------------------------------------------------------
  console.log("\nPassword login is unchanged");
  // -------------------------------------------------------------------------
  // The password provider's own path is exercised by verify:stage3; what
  // matters here is that Stage 4 did not disturb the credential it reads.
  const passwordUser = await prisma.user.findUnique({
    where: { id: active.userId },
    select: { passwordHash: true, emailVerifiedAt: true, accountStatus: true },
  });

  check("the password hash is intact", passwordUser?.passwordHash === PASSWORD_HASH);
  check("the account is still active", passwordUser?.accountStatus === "ACTIVE");
  check("the email is still verified", passwordUser?.emailVerifiedAt !== null);
}

/**
 * Removes this run's fixtures — and then CHECKS that it did.
 *
 * The self-check is not defensive padding. A fixture tenant left behind is not a
 * harmless orphan: it is an ACTIVE tenant with no plan and no account-wide role
 * holder, which is exactly what `npm run stage1:verify` asserts against, so a
 * silent leak here surfaces later as two unexplained failures in a different
 * script. That happened once during development. A leak now reports itself,
 * against the run that caused it.
 *
 * Prefixed with the run's own timestamp throughout, so two runs never contend.
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
        ? "\nStage 4 verification: all checks passed."
        : `\nStage 4 verification: ${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
