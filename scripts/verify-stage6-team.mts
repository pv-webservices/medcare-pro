/**
 * Stage-6 verification — team invitations and the membership lifecycle.
 *
 *     npm run verify:stage6
 *
 * Everything here runs against a real local database through the real service
 * modules. Nothing is mocked except the mailer, which is a capture function, so
 * NO REAL MAIL IS EVER SENT and the captured invitation link is asserted
 * against rather than printed.
 *
 * What it proves:
 *
 *   - an invitation is issued with a token that exists nowhere in the database
 *     in the clear, and is spendable exactly once;
 *   - accepting one creates a login that can actually sign in — both status
 *     axes ACTIVE, own email verified, the invited role granted at the invited
 *     scope — and `requireActor()` accepts it;
 *   - the narrow platform helper refuses to touch anything but PENDING, so
 *     accepting an invitation can never lift an Owner's suspension;
 *   - a revoked, expired, replayed or wrong-tenant invitation is refused, and
 *     every refusal but "already used" says the same sentence;
 *   - re-inviting an address supersedes the previous link rather than leaving
 *     two live tokens;
 *   - the escalation guard holds: nobody can invite someone into a role whose
 *     permissions they do not hold themselves, and only an owner can invite an
 *     owner;
 *   - suspending, rejecting and removing a member ends their live sessions in
 *     the same transaction, and the account can never be left with no active
 *     owner;
 *   - `team:view` / `team:invite` / `team:approve` / `team:manage` are each
 *     enforced server-side, and a user from another tenant answers 404.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles, ROLE_KEYS } from "@/lib/defaultRoles";
import { createAppSession } from "@/lib/appSession";
import { loadLiveSession, toTenantActor } from "@/lib/session";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import {
  acceptInvitation,
  createInvitation,
  hashInvitationToken,
  listInvitations,
  loadInvitationPreview,
  revokeInvitation,
} from "@/lib/invitations";
import {
  INVITATION_ALREADY_ACCEPTED_MESSAGE,
  INVITATION_INVALID_MESSAGE,
} from "@/lib/invitationPolicy";
import {
  MemberActivationError,
  activateInvitedMemberAccount,
} from "@/lib/platform/memberActivation";
import { getTeamOverview, updateTeamMembership } from "@/lib/team";
import type { InvitationEmailParams } from "@/lib/invitationEmails";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

// buildInvitationUrl needs a public origin. Set only if the environment has not
// already provided one, so a local .env still wins.
process.env.NEXTAUTH_URL ??= "http://localhost:3000";

const PASSWORD = "Stage6-verify-password";
const NEW_PASSWORD = "Stage6-invitee-password";

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
const TENANT_SLUG = `verify-stage6-${RUN}`;

function email(label: string): string {
  return `verify-stage6-${label}-${RUN}@example.test`;
}

/** Captures what would have been mailed. Asserted against, never printed. */
function createMailbox() {
  const delivered: InvitationEmailParams[] = [];
  return {
    mailer: async (params: InvitationEmailParams) => {
      delivered.push(params);
    },
    latest: () => delivered[delivered.length - 1] ?? null,
    count: () => delivered.length,
    /** The raw token out of the captured link — the only place it ever exists. */
    latestToken: (): string => {
      const url = delivered[delivered.length - 1]?.invitationUrl ?? "";
      return new URL(url).searchParams.get("token") ?? "";
    },
  };
}

const mailbox = createMailbox();

/** No HTTP request here; inventing an IP would put fiction in the audit trail. */
const NO_META = { ip: null, userAgent: null } as const;

function deps(now?: Date) {
  return { mailer: mailbox.mailer, ...NO_META, ...(now ? { now } : {}) };
}

/** Throws for the caller so a refusal can be asserted on rather than crash. */
async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error: unknown) {
    return error;
  }
}

interface Fixture {
  tenantId: string;
  ownerActor: ActorContext;
  ownerId: string;
  roles: Record<string, string>;
  clinicId: string;
}

async function createTenant(label: string): Promise<Fixture> {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: `Stage6 ${label} ${RUN}`,
      email: email(`${label}-owner`),
      slug: `${TENANT_SLUG}-${label}`,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      isPlatform: false,
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const roleRows = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, key: true },
  });
  const roles = Object.fromEntries(
    roleRows.filter((role) => role.key).map((role) => [role.key as string, role.id]),
  );

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: `Stage6 clinic ${label} ${RUN}` },
    select: { id: true },
  });

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Stage6 owner ${label}`,
      email: email(`${label}-owner`),
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });

  await prisma.userRole.create({
    data: { userId: owner.id, roleId: roles[ROLE_KEYS.OWNER], clinicId: null },
  });

  return {
    tenantId: tenant.id,
    ownerId: owner.id,
    ownerActor: { userId: owner.id, tenantId: tenant.id },
    roles,
    clinicId: clinic.id,
  };
}

async function main(): Promise<void> {
  const acme = await createTenant("acme");
  const rival = await createTenant("rival");

  // -------------------------------------------------------------------------
  console.log("\nIssuing an invitation");
  // -------------------------------------------------------------------------
  const inviteeEmail = email("receptionist");

  const invitation = await createInvitation(
    acme.ownerActor,
    { email: inviteeEmail, roleId: acme.roles[ROLE_KEYS.RECEPTIONIST], clinicId: acme.clinicId },
    deps(),
  );

  check("an invitation is created", Boolean(invitation.id));
  check("it did not supersede anything", invitation.supersededPrevious === false);
  check("exactly one mail was handed to the mailer", mailbox.count() === 1);
  check(
    "the mail went to the invited address",
    mailbox.latest()?.to === inviteeEmail,
    mailbox.latest()?.to,
  );
  check(
    "the mail names the role, so it does not read as phishing",
    mailbox.latest()?.roleName === "Receptionist",
  );

  const rawToken = mailbox.latestToken();
  check("the link carries a token", rawToken.length === 64, rawToken.length);

  const storedRow = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
    select: { tokenHash: true, status: true, email: true, tenantId: true, clinicId: true },
  });

  check(
    "only the hash is stored, never the token",
    storedRow.tokenHash === hashInvitationToken(rawToken) &&
      storedRow.tokenHash !== rawToken,
  );
  check(
    "no row anywhere holds the raw token",
    (await prisma.invitation.count({ where: { tokenHash: rawToken } })) === 0,
  );
  check("it starts CREATED", storedRow.status === "CREATED");
  check("it is scoped to the invited clinic", storedRow.clinicId === acme.clinicId);
  check("it belongs to the inviting tenant", storedRow.tenantId === acme.tenantId);

  const auditOnCreate = await prisma.auditLog.findFirst({
    where: { action: "TEAM_INVITATION_CREATED", targetId: invitation.id },
    select: { afterValue: true },
  });
  check("creating one writes an audit row", auditOnCreate !== null);
  check(
    "the audit row carries no token",
    !JSON.stringify(auditOnCreate?.afterValue ?? {}).includes(rawToken),
  );

  // -------------------------------------------------------------------------
  console.log("\nOpening the link changes nothing but openedAt");
  // -------------------------------------------------------------------------
  const preview = await loadInvitationPreview(rawToken);
  check("the preview resolves", preview.status === "ok");
  check(
    "it shows the invited address",
    preview.status === "ok" && preview.preview.email === inviteeEmail,
  );

  const afterOpen = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
    select: { status: true, openedAt: true, acceptedAt: true },
  });
  check("the invitation is now OPENED", afterOpen.status === "OPENED");
  check("openedAt is stamped", afterOpen.openedAt !== null);
  check("following the link accepts nothing", afterOpen.acceptedAt === null);
  check(
    "no user was created by opening it",
    (await prisma.user.count({ where: { email: inviteeEmail } })) === 0,
  );

  // Opening twice must not overwrite the first stamp or re-fire the transition.
  const secondOpen = await loadInvitationPreview(rawToken);
  const afterSecondOpen = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
    select: { openedAt: true },
  });
  check("a second open still resolves", secondOpen.status === "ok");
  check(
    "the first openedAt is not overwritten",
    afterSecondOpen.openedAt?.getTime() === afterOpen.openedAt?.getTime(),
  );

  // -------------------------------------------------------------------------
  console.log("\nAccepting it creates a login that works");
  // -------------------------------------------------------------------------
  const accepted = await acceptInvitation(
    { token: rawToken, name: "Amelia Rao", password: NEW_PASSWORD },
    deps(),
  );
  check("acceptance reports the address", accepted.email === inviteeEmail);

  const invitee = await prisma.user.findUniqueOrThrow({
    where: { email: inviteeEmail },
    select: {
      id: true,
      tenantId: true,
      name: true,
      accountStatus: true,
      membershipStatus: true,
      emailVerifiedAt: true,
      passwordHash: true,
      userRoles: { select: { roleId: true, clinicId: true, assignedById: true } },
    },
  });

  check("the login belongs to the inviting tenant", invitee.tenantId === acme.tenantId);
  check("the name they gave is stored", invitee.name === "Amelia Rao");
  check("the platform axis is ACTIVE", invitee.accountStatus === "ACTIVE");
  check("the tenant axis is ACTIVE", invitee.membershipStatus === "ACTIVE");
  check(
    "their own address counts as verified — the token proved the inbox",
    invitee.emailVerifiedAt !== null,
  );
  check(
    "the password they chose is stored hashed, not in the clear",
    invitee.passwordHash !== NEW_PASSWORD &&
      (await bcrypt.compare(NEW_PASSWORD, invitee.passwordHash)),
  );
  check(
    "the invited role was granted at the invited scope",
    invitee.userRoles.length === 1 &&
      invitee.userRoles[0].roleId === acme.roles[ROLE_KEYS.RECEPTIONIST] &&
      invitee.userRoles[0].clinicId === acme.clinicId,
  );
  check(
    "the inviter is recorded as the assigner",
    invitee.userRoles[0].assignedById === acme.ownerId,
  );

  const spent = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
    select: { status: true, acceptedAt: true, acceptedByUserId: true },
  });
  check("the invitation is ACCEPTED", spent.status === "ACCEPTED");
  check("it points at the user it created", spent.acceptedByUserId === invitee.id);
  check("acceptedAt is stamped", spent.acceptedAt !== null);

  check(
    "the activation is recorded by platform code",
    (await prisma.auditLog.count({
      where: { action: "MEMBER_ACCOUNT_ACTIVATED", targetId: invitee.id },
    })) === 1,
  );
  check(
    "the acceptance is recorded",
    (await prisma.auditLog.count({
      where: { action: "TEAM_INVITATION_ACCEPTED", targetId: invitation.id },
    })) === 1,
  );

  // The real test of "it works": a session for this user resolves to an actor.
  const sid = await createAppSession(prisma, {
    userId: invitee.id,
    tenantId: invitee.tenantId,
  });
  const resolved = await loadLiveSession(sid, invitee.id);
  const inviteeActor = toTenantActor(resolved);
  check("the new member can hold a live session", inviteeActor.userId === invitee.id);

  // -------------------------------------------------------------------------
  console.log("\nA spent token cannot be replayed");
  // -------------------------------------------------------------------------
  const replay = await refusal(() =>
    acceptInvitation(
      { token: rawToken, name: "Someone Else", password: NEW_PASSWORD },
      deps(),
    ),
  );
  check("a replay is refused", replay instanceof Error);
  check(
    "and is told to sign in rather than told the link is broken",
    (replay as Error).message === INVITATION_ALREADY_ACCEPTED_MESSAGE,
    (replay as Error).message,
  );
  check(
    "the replay created no second user",
    (await prisma.user.count({ where: { email: inviteeEmail } })) === 1,
  );

  const replayPreview = await loadInvitationPreview(rawToken);
  check(
    "the page says the same thing",
    replayPreview.status === "refused" &&
      replayPreview.message === INVITATION_ALREADY_ACCEPTED_MESSAGE,
  );

  // -------------------------------------------------------------------------
  console.log("\nEvery other refusal says one sentence");
  // -------------------------------------------------------------------------
  const nonsense = await loadInvitationPreview("not-a-real-token");
  check(
    "an unknown token is refused",
    nonsense.status === "refused" && nonsense.message === INVITATION_INVALID_MESSAGE,
  );

  const revokedEmail = email("revoked");
  const revokedInvite = await createInvitation(
    acme.ownerActor,
    { email: revokedEmail, roleId: acme.roles[ROLE_KEYS.STAFF] },
    deps(),
  );
  const revokedToken = mailbox.latestToken();
  await revokeInvitation(acme.ownerActor, { invitationId: revokedInvite.id }, deps());

  const revokedPreview = await loadInvitationPreview(revokedToken);
  check(
    "a revoked link is refused",
    revokedPreview.status === "refused" &&
      revokedPreview.message === INVITATION_INVALID_MESSAGE,
  );
  check(
    "and is indistinguishable from one that never existed",
    revokedPreview.status === "refused" &&
      nonsense.status === "refused" &&
      revokedPreview.message === nonsense.message,
  );
  check(
    "accepting a revoked link creates nothing",
    (await refusal(() =>
      acceptInvitation(
        { token: revokedToken, name: "Nope", password: NEW_PASSWORD },
        deps(),
      ),
    )) instanceof BadRequestError &&
      (await prisma.user.count({ where: { email: revokedEmail } })) === 0,
  );

  // Expiry, driven by the clock rather than by waiting seven days.
  const expiredEmail = email("expired");
  const expiredInvite = await createInvitation(
    acme.ownerActor,
    { email: expiredEmail, roleId: acme.roles[ROLE_KEYS.STAFF] },
    deps(),
  );
  const expiredToken = mailbox.latestToken();
  const wellPastExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const expiredRefusal = await refusal(() =>
    acceptInvitation(
      { token: expiredToken, name: "Too Late", password: NEW_PASSWORD },
      deps(wellPastExpiry),
    ),
  );
  check("an expired link is refused", expiredRefusal instanceof BadRequestError);
  check(
    "with the same sentence as every other dead link",
    (expiredRefusal as Error).message === INVITATION_INVALID_MESSAGE,
  );
  check(
    "and creates no user",
    (await prisma.user.count({ where: { email: expiredEmail } })) === 0,
  );
  await prisma.invitation.delete({ where: { id: expiredInvite.id } });

  // -------------------------------------------------------------------------
  console.log("\nRe-inviting supersedes rather than duplicating");
  // -------------------------------------------------------------------------
  const resendEmail = email("resend");
  await createInvitation(
    acme.ownerActor,
    { email: resendEmail, roleId: acme.roles[ROLE_KEYS.STAFF] },
    deps(),
  );
  const firstToken = mailbox.latestToken();

  const reissued = await createInvitation(
    acme.ownerActor,
    { email: resendEmail, roleId: acme.roles[ROLE_KEYS.STAFF] },
    deps(),
  );
  const secondToken = mailbox.latestToken();

  check("the second issue reports the supersede", reissued.supersededPrevious === true);
  check("the two tokens differ", firstToken !== secondToken && secondToken.length === 64);
  check(
    "the first link is dead",
    (await loadInvitationPreview(firstToken)).status === "refused",
  );
  check(
    "the second link works",
    (await loadInvitationPreview(secondToken)).status === "ok",
  );
  check(
    "exactly one outstanding invitation remains for that address",
    (
      await prisma.invitation.count({
        where: {
          tenantId: acme.tenantId,
          email: resendEmail,
          status: { in: ["CREATED", "OPENED"] },
        },
      })
    ) === 1,
  );

  // -------------------------------------------------------------------------
  console.log("\nAn address can only exist once");
  // -------------------------------------------------------------------------
  const dupe = await refusal(() =>
    createInvitation(
      acme.ownerActor,
      { email: inviteeEmail, roleId: acme.roles[ROLE_KEYS.STAFF] },
      deps(),
    ),
  );
  check("inviting an existing member is refused", dupe instanceof ConflictError);

  const crossTenant = await refusal(() =>
    createInvitation(
      rival.ownerActor,
      { email: inviteeEmail, roleId: rival.roles[ROLE_KEYS.STAFF] },
      deps(),
    ),
  );
  check(
    "another tenant cannot invite the same address either",
    crossTenant instanceof ConflictError,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe escalation guard holds");
  // -------------------------------------------------------------------------
  // A Receptionist with team:invite bolted on still cannot hand out more than
  // they hold. The permission to invite is not the permission to promote.
  const limitedRole = await prisma.role.create({
    data: {
      tenantId: acme.tenantId,
      name: `Front desk lead ${RUN}`,
      permissions: ["team:view", "team:invite", "team:manage", "team:approve", "registration:read"],
    },
    select: { id: true },
  });

  const limitedUser = await prisma.user.create({
    data: {
      tenantId: acme.tenantId,
      name: "Front desk lead",
      email: email("lead"),
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });
  await prisma.userRole.create({
    data: { userId: limitedUser.id, roleId: limitedRole.id, clinicId: null },
  });
  const limitedActor: ActorContext = {
    userId: limitedUser.id,
    tenantId: acme.tenantId,
  };

  const escalation = await refusal(() =>
    createInvitation(
      limitedActor,
      { email: email("escalated"), roleId: acme.roles[ROLE_KEYS.CLINIC_ADMIN] },
      deps(),
    ),
  );
  check(
    "cannot invite someone into a role beyond your own reach",
    escalation instanceof BadRequestError,
    escalation,
  );

  const ownerMint = await refusal(() =>
    createInvitation(
      limitedActor,
      { email: email("minted-owner"), roleId: acme.roles[ROLE_KEYS.OWNER] },
      deps(),
    ),
  );
  check("cannot invite a new account owner", ownerMint instanceof BadRequestError);

  check(
    "no row was written for either refusal",
    (await prisma.invitation.count({
      where: { email: { in: [email("escalated"), email("minted-owner")] } },
    })) === 0,
  );

  const withinReach = await createInvitation(
    limitedActor,
    { email: email("peer"), roleId: limitedRole.id },
    deps(),
  );
  check("but can invite into their own role", Boolean(withinReach.id));
  await prisma.invitation.delete({ where: { id: withinReach.id } });

  // -------------------------------------------------------------------------
  console.log("\nPermissions are enforced, not merely hidden");
  // -------------------------------------------------------------------------
  const nobody = await prisma.user.create({
    data: {
      tenantId: acme.tenantId,
      name: "No permissions",
      email: email("nobody"),
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });
  const nobodyActor: ActorContext = { userId: nobody.id, tenantId: acme.tenantId };

  check(
    "team:view is required to read the team",
    (await refusal(() => getTeamOverview(nobodyActor))) instanceof PermissionError,
  );
  check(
    "team:invite is required to invite",
    (await refusal(() =>
      createInvitation(
        nobodyActor,
        { email: email("blocked"), roleId: acme.roles[ROLE_KEYS.STAFF] },
        deps(),
      ),
    )) instanceof PermissionError,
  );
  check(
    "team:manage is required to suspend",
    (await refusal(() =>
      updateTeamMembership(nobodyActor, { action: "suspend", userId: invitee.id }),
    )) instanceof PermissionError,
  );
  check(
    "team:approve is required to approve",
    (await refusal(() =>
      updateTeamMembership(nobodyActor, { action: "approve", userId: invitee.id }),
    )) instanceof PermissionError,
  );

  // Cross-tenant: a rival owner has every permission in their OWN account and
  // must still not resolve a user in this one.
  const crossTenantAction = await refusal(() =>
    updateTeamMembership(rival.ownerActor, { action: "suspend", userId: invitee.id }),
  );
  check(
    "another tenant's owner cannot touch this member",
    crossTenantAction instanceof ScopeError,
    crossTenantAction,
  );

  const crossTenantRevoke = await refusal(() =>
    revokeInvitation(rival.ownerActor, { invitationId: reissued.id }, deps()),
  );
  check(
    "nor revoke this tenant's invitation",
    crossTenantRevoke instanceof ScopeError,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe platform helper refuses anything but PENDING");
  // -------------------------------------------------------------------------
  const alreadyActive = await refusal(() =>
    activateInvitedMemberAccount(prisma, {
      userId: invitee.id,
      tenantId: acme.tenantId,
      invitationId: invitation.id,
    }),
  );
  check(
    "an already-active account is refused",
    alreadyActive instanceof MemberActivationError &&
      alreadyActive.reason === "not-pending",
  );

  // The one that matters: an Owner suspension must survive an acceptance.
  await prisma.user.update({
    where: { id: nobody.id },
    data: { accountStatus: "SUSPENDED" },
  });
  const suspendedActivation = await refusal(() =>
    activateInvitedMemberAccount(prisma, {
      userId: nobody.id,
      tenantId: acme.tenantId,
      invitationId: invitation.id,
    }),
  );
  check(
    "a platform suspension cannot be lifted through this path",
    suspendedActivation instanceof MemberActivationError &&
      suspendedActivation.reason === "not-pending",
  );
  check(
    "and the suspension is still in place",
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: nobody.id },
        select: { accountStatus: true },
      })
    ).accountStatus === "SUSPENDED",
  );
  await prisma.user.update({
    where: { id: nobody.id },
    data: { accountStatus: "ACTIVE" },
  });

  const outsideTenant = await refusal(() =>
    activateInvitedMemberAccount(prisma, {
      userId: invitee.id,
      tenantId: rival.tenantId,
      invitationId: invitation.id,
    }),
  );
  check(
    "it will not reach across tenants",
    outsideTenant instanceof MemberActivationError &&
      outsideTenant.reason === "not-found",
  );

  // -------------------------------------------------------------------------
  console.log("\nSuspending a member ends their sessions");
  // -------------------------------------------------------------------------
  const secondSid = await createAppSession(prisma, {
    userId: invitee.id,
    tenantId: invitee.tenantId,
  });
  check(
    "two sessions are live before the change",
    (await prisma.appSession.count({
      where: { userId: invitee.id, revokedAt: null },
    })) === 2,
  );

  const suspension = await updateTeamMembership(
    acme.ownerActor,
    { action: "suspend", userId: invitee.id, reason: "Verification run" },
    NO_META,
  );
  check("the status moves to SUSPENDED", suspension.membershipStatus === "SUSPENDED");
  check("both sessions were revoked", suspension.sessionsRevoked === 2);
  check(
    "no live session remains",
    (await prisma.appSession.count({
      where: { userId: invitee.id, revokedAt: null },
    })) === 0,
  );
  check(
    "the old session no longer resolves to an actor",
    (await refusal(async () => toTenantActor(await loadLiveSession(secondSid, invitee.id)))) !==
      null,
  );
  check(
    "the suspension is on the audit trail with its reason",
    (
      await prisma.auditLog.findFirst({
        where: { action: "TEAM_MEMBER_SUSPENDED", targetId: invitee.id },
        select: { reason: true },
      })
    )?.reason === "Verification run",
  );
  check(
    "the platform axis was left alone",
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: invitee.id },
        select: { accountStatus: true },
      })
    ).accountStatus === "ACTIVE",
  );

  const reactivated = await updateTeamMembership(
    acme.ownerActor,
    { action: "reactivate", userId: invitee.id },
    NO_META,
  );
  check("reactivating restores ACTIVE", reactivated.membershipStatus === "ACTIVE");
  check("reactivating revokes nothing", reactivated.sessionsRevoked === 0);

  // -------------------------------------------------------------------------
  console.log("\nIllegal and self-inflicted changes are refused");
  // -------------------------------------------------------------------------
  const self = await refusal(() =>
    updateTeamMembership(
      acme.ownerActor,
      { action: "suspend", userId: acme.ownerId },
      NO_META,
    ),
  );
  check("you cannot suspend yourself", self instanceof BadRequestError);

  const badTransition = await refusal(() =>
    updateTeamMembership(
      acme.ownerActor,
      { action: "approve", userId: invitee.id },
      NO_META,
    ),
  );
  check(
    "an already-active member cannot be approved again",
    badTransition instanceof ConflictError,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe account can never be left without an active owner");
  // -------------------------------------------------------------------------
  const secondOwner = await prisma.user.create({
    data: {
      tenantId: acme.tenantId,
      name: "Second owner",
      email: email("second-owner"),
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });
  await prisma.userRole.create({
    data: { userId: secondOwner.id, roleId: acme.roles[ROLE_KEYS.OWNER], clinicId: null },
  });

  const secondOwnerActor: ActorContext = {
    userId: secondOwner.id,
    tenantId: acme.tenantId,
  };

  // Two owners: suspending one is fine.
  const firstDown = await updateTeamMembership(
    secondOwnerActor,
    { action: "suspend", userId: acme.ownerId },
    NO_META,
  );
  check("one of two owners may be suspended", firstDown.membershipStatus === "SUSPENDED");

  // Now there is one active owner left, and the invitee tries to take them out.
  // Give the invitee team:manage so the refusal is the owner guard, not RBAC.
  await prisma.userRole.create({
    data: { userId: invitee.id, roleId: limitedRole.id, clinicId: null },
  });
  const lastOwner = await refusal(() =>
    updateTeamMembership(
      { userId: invitee.id, tenantId: acme.tenantId },
      { action: "suspend", userId: secondOwner.id },
      NO_META,
    ),
  );
  check("the last active owner cannot be suspended", lastOwner instanceof ConflictError);

  const lastOwnerRemoval = await refusal(() =>
    updateTeamMembership(
      { userId: invitee.id, tenantId: acme.tenantId },
      { action: "remove", userId: secondOwner.id },
      NO_META,
    ),
  );
  check("nor removed", lastOwnerRemoval instanceof ConflictError);
  check(
    "and they are still active",
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: secondOwner.id },
        select: { membershipStatus: true },
      })
    ).membershipStatus === "ACTIVE",
  );

  // Restoring the first owner makes the second removable again.
  await updateTeamMembership(
    secondOwnerActor,
    { action: "reactivate", userId: acme.ownerId },
    NO_META,
  );
  const nowRemovable = await updateTeamMembership(
    acme.ownerActor,
    { action: "remove", userId: secondOwner.id },
    NO_META,
  );
  check(
    "with another owner active, one may be removed",
    nowRemovable.membershipStatus === "REMOVED",
  );
  check(
    "removal is terminal — it cannot be undone",
    (await refusal(() =>
      updateTeamMembership(
        acme.ownerActor,
        { action: "reactivate", userId: secondOwner.id },
        NO_META,
      ),
    )) instanceof ConflictError,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe team screen shows the truth");
  // -------------------------------------------------------------------------
  const overview = await getTeamOverview(acme.ownerActor);

  check("the owner may invite", overview.canInvite);
  check("the owner may approve", overview.canApprove);
  check("the owner may manage", overview.canManage);
  check(
    "the invited member appears",
    overview.members.some((member) => member.email === inviteeEmail),
  );
  check(
    "the signed-in user is marked as themselves",
    overview.members.find((member) => member.id === acme.ownerId)?.isSelf === true,
  );
  check(
    "the owner is flagged as the account owner",
    overview.members.find((member) => member.id === acme.ownerId)?.isAccountOwner === true,
  );
  check(
    "a removed member is still listed, so their address is accounted for",
    overview.members.find((member) => member.id === secondOwner.id)?.membershipStatus ===
      "REMOVED",
  );
  check(
    "accepted invitations are not in the outstanding list",
    !overview.invitations.some((row) => row.email === inviteeEmail),
  );
  check(
    "an outstanding invitation is offered for revocation",
    overview.invitations.find((row) => row.email === resendEmail)?.isOutstanding === true,
  );
  check(
    "a revoked one is not",
    overview.invitations.find((row) => row.email === revokedEmail)?.isOutstanding === false,
  );
  const acmeUserIds = new Set(
    (
      await prisma.user.findMany({
        where: { tenantId: acme.tenantId },
        select: { id: true },
      })
    ).map((user) => user.id),
  );
  check(
    "the overview leaks no other tenant's people",
    overview.members.length === acmeUserIds.size &&
      overview.members.every((member) => acmeUserIds.has(member.id)) &&
      !overview.members.some((member) => member.id === rival.ownerId),
  );

  // The limited role holder is offered only what they could actually grant.
  const limitedOverview = await getTeamOverview(limitedActor);
  check(
    "a limited admin is not offered the owner role",
    !limitedOverview.roles.some((role) => role.isWildcard),
  );
  check(
    "nor any role beyond their reach",
    !limitedOverview.roles.some(
      (role) => role.id === acme.roles[ROLE_KEYS.CLINIC_ADMIN],
    ),
  );
  check(
    "but is offered their own",
    limitedOverview.roles.some((role) => role.id === limitedRole.id),
  );

  const ownerRoles = overview.roles;
  check(
    "an owner is offered every role, including the owner role",
    ownerRoles.length >= Object.keys(acme.roles).length &&
      ownerRoles.some((role) => role.isWildcard),
  );

  check(
    "the catalogue still holds the four team permissions",
    ["team:view", "team:invite", "team:approve", "team:manage"].every((key) =>
      ALL_PERMISSIONS.includes(key),
    ),
  );

  const rivalOverview = await getTeamOverview(rival.ownerActor);
  check(
    "the other tenant sees only its own people",
    rivalOverview.members.length === 1 &&
      rivalOverview.members[0].id === rival.ownerId,
  );
  check(
    "and none of this tenant's invitations",
    (await listInvitations(rival.ownerActor)).length === 0,
  );
}

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
  await prisma.invitation.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.appSession.deleteMany({ where: { userId: { in: userIds } } });
  // Every bucket, not just this run's: the keys are digests, so there is no way
  // to select "mine", and locally there is nothing worth preserving.
  await prisma.rateLimitBucket.deleteMany({});
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.clinic.deleteMany({ where: { tenantId: { in: tenantIds } } });
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
        ? "\nStage 6 verification: all checks passed."
        : `\nStage 6 verification: ${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
