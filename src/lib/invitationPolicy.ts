import type { InvitationStatus } from "@prisma/client";

/**
 * The rules an invitation lives by — Stage 6.
 *
 * Pure data and pure functions: no Prisma, no session, no crypto. Everything
 * here can be unit-tested without a database, which is the point — these are
 * the decisions that say whether a stranger holding a link becomes a member of
 * someone's clinic, and they should be provable in isolation.
 *
 * Type-only import, so this module has no Prisma client at runtime.
 *
 * WHY THE COPY IS ALMOST ALWAYS THE SAME SENTENCE. The accept page is public
 * and the token in the URL is the only credential. Telling its holder whether a
 * link was revoked, expired, or never existed turns the page into an oracle
 * about a tenant they may have nothing to do with. One refusal covers all of
 * them.
 *
 * The single exception is `already-accepted`, and it is deliberate: the person
 * who clicks their own link a second time after signing up is the overwhelmingly
 * common case, and sending them to the login page is the only helpful answer.
 * What it discloses — that this exact token was spent — is disclosed only to
 * whoever already holds the token.
 */

export const INVITATION_STATUS_TRANSITIONS: Record<
  InvitationStatus,
  readonly InvitationStatus[]
> = {
  /** Issued and mailed; nobody has followed the link yet. */
  CREATED: ["OPENED", "ACCEPTED", "REVOKED", "EXPIRED"],
  /** The link has been fetched at least once. Still spendable. */
  OPENED: ["ACCEPTED", "REVOKED", "EXPIRED"],
  // The three below are terminal. An accepted invitation is spent, a revoked
  // one was withdrawn on purpose, and an expired one is reissued rather than
  // revived — a fresh invitation gets a fresh token, which a revival would not.
  ACCEPTED: [],
  REVOKED: [],
  EXPIRED: [],
};

export function canTransitionInvitationStatus(
  from: InvitationStatus,
  to: InvitationStatus,
): boolean {
  return INVITATION_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Seven days. Not in the PRD — chosen so an invitation survives a week of
 * annual leave but does not sit live in an inbox for a month. Long enough to be
 * usable, short enough that a forgotten link stops being a way in.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function computeInvitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

/** Why an invitation cannot be spent. For the server log and the audit trail. */
export type InvitationRefusal =
  | "not-found"
  | "revoked"
  | "expired"
  | "already-accepted"
  | "tenant-inactive";

export interface InvitationSnapshot {
  status: InvitationStatus;
  expiresAt: Date;
  /**
   * The invited address. Stage 6 requires one on every invitation it issues, so
   * this is non-null in practice; the column stays nullable because the schema
   * allows a link-only invitation that this stage deliberately does not create.
   */
  email: string | null;
  /** The invitation is void if the organisation is no longer active. */
  isTenantActive: boolean;
}

export interface InvitationVerdict {
  usable: boolean;
  refusal: InvitationRefusal | null;
}

const USABLE: InvitationVerdict = { usable: true, refusal: null };

/**
 * The one place that decides whether an invitation may be spent.
 *
 * Order matters. `already-accepted` is tested before expiry so that a person
 * returning to their own spent link after a week is told to sign in rather than
 * told the link expired — both are true, only one is useful.
 */
export function evaluateInvitation(input: {
  snapshot: InvitationSnapshot | null;
  now?: Date;
}): InvitationVerdict {
  const { snapshot } = input;
  const now = input.now ?? new Date();

  if (!snapshot) {
    return { usable: false, refusal: "not-found" };
  }

  if (snapshot.status === "ACCEPTED") {
    return { usable: false, refusal: "already-accepted" };
  }

  if (snapshot.status === "REVOKED") {
    return { usable: false, refusal: "revoked" };
  }

  // Both the stored status and the clock are checked. The status is only ever
  // EXPIRED if something swept it, and nothing sweeps it today — expiry is
  // enforced here, on read, so an unswept row is still refused on time.
  if (snapshot.status === "EXPIRED" || snapshot.expiresAt.getTime() <= now.getTime()) {
    return { usable: false, refusal: "expired" };
  }

  if (!snapshot.isTenantActive) {
    return { usable: false, refusal: "tenant-inactive" };
  }

  if (!snapshot.email) {
    // Stage 6 issues no link-only invitations. One found here predates this
    // stage or was written outside it, and is refused rather than guessed at.
    return { usable: false, refusal: "not-found" };
  }

  return USABLE;
}

export const INVITATION_INVALID_MESSAGE =
  "This invitation link is not valid. Ask your administrator to send you a new one.";

export const INVITATION_ALREADY_ACCEPTED_MESSAGE =
  "This invitation has already been used. Sign in with your email and password.";

/**
 * The sentence shown for a refusal. Every reason but one collapses to the same
 * string — see the note at the top of this file.
 */
export function describeInvitationRefusal(refusal: InvitationRefusal): string {
  return refusal === "already-accepted"
    ? INVITATION_ALREADY_ACCEPTED_MESSAGE
    : INVITATION_INVALID_MESSAGE;
}

/**
 * Whether an invitation is still outstanding, for the "open invitations" list
 * and for deciding that a new invitation to the same address supersedes it.
 *
 * A clock-expired row counts as closed even while its stored status still says
 * CREATED, so the list never offers to revoke something already dead.
 */
export function isInvitationOutstanding(
  snapshot: Pick<InvitationSnapshot, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (snapshot.status !== "CREATED" && snapshot.status !== "OPENED") {
    return false;
  }
  return snapshot.expiresAt.getTime() > now.getTime();
}

/** Normalises an address for comparison and storage. */
export function normaliseInviteEmail(value: string): string {
  return value.trim().toLowerCase();
}
