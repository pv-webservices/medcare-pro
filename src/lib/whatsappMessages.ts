import { z } from "zod";
import { BadRequestError } from "@/lib/apiHandler";
import { clinicWhereForActor } from "@/lib/clinicScope";
import {
  dateOnlyInTimeZone,
  formatClockTime,
  formatDateOnly,
} from "@/lib/dates";
import {
  DEFAULT_HISTORY_TIMEZONE,
  getStartOfDayInTimeZone,
  shiftDateString,
} from "@/lib/messageHistoryFilter";
import { formatRupees } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  assertClinicInTenant,
  PermissionError,
  requirePermission,
  type ActorContext,
} from "@/lib/rbac";
import {
  checkNumber,
  sendMedia,
  sendText,
  type MediaType,
  type SendResult,
} from "@/lib/whatsapp";
import { resolveWhatsappConfigForClinic } from "@/lib/whatsappProviderConfig";
import {
  buildMediaContentUrl,
  buildDocumentContentUrl,
} from "@/lib/mediaSecurity";
import { MediaConfigurationError } from "@/lib/mediaTypes";
import { toWhatsappDigits } from "@/lib/whatsappNumber";
import type { Prisma } from "@prisma/client";
import {
  assertCanSendSomewhere,
  getTemplateForActor,
  renderTemplate,
  type TemplateRecord,
  type TemplateValues,
} from "@/lib/whatsappTemplates";

/**
 * Sending approved templates to patients, and the history of what went out —
 * FR-9.1 / FR-9.2.
 *
 * The provider takes one recipient per call, so a send to several patients is
 * a loop here rather than one bulk request. That is deliberate and not just a
 * limitation: one `whatsapp_messages` row per recipient is what FR-9.2 needs
 * anyway ("delivery status visible against the message"), and a bulk call that
 * half-succeeded would give one status for many people. If the provider later
 * exposes a true list endpoint, it can be swapped in behind `sendToPatients`
 * without changing anything that calls it.
 *
 * Sends are sequential, not `Promise.all`: firing twenty simultaneous requests
 * at a gateway driving real phones is how a number gets rate-limited or
 * flagged. A small delay between sends is applied for the same reason.
 *
 * **What "sent" means here.** RkvRobo has no delivery-status callback, so a
 * row reaching `sent` means the gateway accepted it — not that WhatsApp
 * delivered or the patient read it. Every label in the UI says so.
 */

/** Recorded in `whatsapp_messages.status`. Not a WhatsApp delivery receipt. */
export const MESSAGE_STATUSES = ["sent", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Enough to be polite to the gateway without making a bulk send feel stuck. */
const DELAY_BETWEEN_SENDS_MS = 350;

/** A claim is two statements; this only bounds waiting behind other claims. */
const CLAIM_WAIT_MS = 10_000;

/** One request should not hold a connection open for an unbounded batch. */
export const MAX_RECIPIENTS = 50;

export const sendMessageSchema = z.object({
  templateId: z.string().trim().min(1).max(64),
  /**
   * Patient ids, not phone numbers. The number is read from the patient record
   * server-side so a caller cannot message an arbitrary phone through this
   * account, and so every send is attributable to a real patient.
   */
  patientIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1, "Choose at least one patient.")
    .max(MAX_RECIPIENTS, `Send to at most ${MAX_RECIPIENTS} patients at a time.`)
    .transform((values) => [...new Set(values)]),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * Written to `whatsapp_messages.status` BEFORE the gateway is called, and
 * replaced by `sent` or `failed` once it answers. It is what an overlapping
 * send — a retry after a timed-out request, a second tab, the other app
 * instance — sees, so it cannot message the same person again meanwhile.
 *
 * A row left `sending` (the process died mid-call) may or may not have gone
 * out, so it keeps blocking the template for that day, like `sent`.
 */
export const IN_FLIGHT_STATUS = "sending";

/** Statuses that mean "this template already reached (or is reaching) them". */
const BLOCKING_STATUSES = ["sent", IN_FLIGHT_STATUS];

/**
 * `skipped` is a per-send outcome only — never written to `whatsapp_messages`,
 * because nothing was attempted. See `claimRecipient`.
 */
export type RecipientStatus = MessageStatus | "skipped";

export interface RecipientResult {
  patientId: string;
  patientName: string;
  patientCode: string;
  status: RecipientStatus;
  /** The gateway's reason when it refused (shown verbatim), or why it was skipped. */
  failureReason: string | null;
}

export interface SendMessageResult {
  templateName: string;
  sent: number;
  failed: number;
  skipped: number;
  results: RecipientResult[];
}

export const ALREADY_SENT_TODAY_REASON = "Already sent this template today.";
export const SAME_NUMBER_SENT_TODAY_REASON =
  "This mobile number already received this template today (it is shared with another patient record).";

export interface MessageRecord {
  id: string;
  templateName: string;
  status: string;
  failureReason: string | null;
  providerMessageId: string | null;
  senderNumber: string | null;
  sentAt: Date;
  clinicName: string;
  patientName: string;
  patientCode: string;
  mobileNumber: string;
}

/**
 * A patient plus the visit the placeholders describe.
 *
 * The most recent registration is used: a reminder or confirmation is almost
 * always about the visit just booked, and a patient with no visit at all
 * cannot have been registered in the first place.
 */
interface Recipient {
  id: string;
  name: string;
  patientCode: string;
  mobileNumber: string;
  clinicId: string;
  clinicName: string;
  values: TemplateValues;
}

/** The gateway wants digits only, e.g. 919812345678. */
const toDigits = toWhatsappDigits;

async function loadRecipients(
  actor: ActorContext,
  patientIds: readonly string[],
): Promise<Recipient[]> {
  // Scoped exactly like every other patient read: the actor's clinic reach,
  // intersected with their tenant. A patient id from another account, or from
  // a clinic this user cannot see, simply does not come back.
  //
  // Nested under `clinic`, not spread — the fragment describes a CLINIC, and
  // spreading it here would apply its `id` to the patient instead.
  const clinicWhere = await clinicWhereForActor(actor, "message:send");

  if (clinicWhere === null) {
    throw new PermissionError("message:send");
  }

  const patients = await prisma.patient.findMany({
    where: {
      id: { in: [...patientIds] },
      tenantId: actor.tenantId,
      clinic: clinicWhere,
    },
    select: {
      id: true,
      name: true,
      patientCode: true,
      mobileNumber: true,
      clinicId: true,
      clinic: { select: { name: true } },
      registrations: {
        orderBy: { visitDate: "desc" },
        take: 1,
        select: {
          department: true,
          amount: true,
          visitDate: true,
          doctor: { select: { name: true } },
        },
      },
    },
  });

  return patients.map((patient) => {
    const visit = patient.registrations[0];

    return {
      id: patient.id,
      name: patient.name,
      patientCode: patient.patientCode,
      mobileNumber: patient.mobileNumber,
      clinicId: patient.clinicId,
      clinicName: patient.clinic.name,
      values: {
        patientName: patient.name,
        patientCode: patient.patientCode,
        clinicName: patient.clinic.name,
        doctorName: visit?.doctor?.name ?? undefined,
        department: visit?.department ?? undefined,
        // Formatted the way the rest of the app reads dates back out of
        // `visit_date`, which stores wall-clock time tagged UTC.
        visitDate: visit ? formatDateOnly(visit.visitDate) : undefined,
        visitTime: visit ? formatClockTime(visit.visitDate) : undefined,
        amount: visit ? formatRupees(visit.amount.toString()) : undefined,
      },
    };
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The current day in clinic-local time, as a half-open [start, end) instant
 * range. Same zone and day boundary as Message History's "Today" filter, so a
 * message listed under Today is exactly one that blocks a repeat send.
 */
export function todaySendWindow(now: Date = new Date()): { start: Date; end: Date } {
  const localToday = dateOnlyInTimeZone(now, DEFAULT_HISTORY_TIMEZONE);

  return {
    start: getStartOfDayInTimeZone(localToday, DEFAULT_HISTORY_TIMEZONE),
    end: getStartOfDayInTimeZone(
      shiftDateString(localToday, 1),
      DEFAULT_HISTORY_TIMEZONE,
    ),
  };
}

interface SentTodayScope {
  clinic: { tenantId: string };
  clinicId?: string;
}

/** Who this template has already reached today — by record and by phone. */
export interface SentToday {
  patientIds: string[];
  /** Normalised with `toWhatsappDigits`. */
  mobileNumbers: string[];
}

/**
 * Who already received this template today — one template reaches a person at
 * most once per day.
 *
 * Matched by patient AND by normalised mobile number: `patients.mobile_number`
 * is not unique, so the same person registered twice (or a family sharing a
 * phone) is several records behind one WhatsApp chat, and a bulk "select all"
 * picks every one of them.
 *
 * `sent` and `sending` rows count; a `failed` attempt never reached the
 * patient, so the front desk must be free to retry it. Matched on the
 * denormalised template name because that is what the history row carries;
 * names are unique per account (`@@unique([tenantId, name])`).
 *
 * CALLERS OWN SCOPING. `scope` must already pin the rows to the actor's tenant
 * and reach — this only adds the template and the day.
 */
async function sentTemplateToday(
  client: Prisma.TransactionClient,
  templateName: string,
  scope: SentTodayScope,
  now: Date = new Date(),
): Promise<SentToday> {
  const { start, end } = todaySendWindow(now);
  const rows = await client.whatsappMessage.findMany({
    where: {
      ...scope,
      templateName,
      status: { in: BLOCKING_STATUSES },
      sentAt: { gte: start, lt: end },
    },
    select: { patientId: true, patient: { select: { mobileNumber: true } } },
  });

  return {
    patientIds: [...new Set(rows.map((row) => row.patientId))],
    mobileNumbers: [
      ...new Set(rows.map((row) => toWhatsappDigits(row.patient.mobileNumber))),
    ],
  };
}

/**
 * The composer's "already sent today" markers for one clinic. Requires
 * `message:send` in that clinic. Advisory only — `claimRecipient` is the
 * guard, and it also sees the account's other clinics.
 */
export async function listSentTemplateToday(
  actor: ActorContext,
  templateId: string,
  clinicId: string,
): Promise<SentToday> {
  await requirePermission(actor, "message:send", clinicId);
  const template = await getTemplateForActor(actor, templateId);

  return sentTemplateToday(prisma, template.name, {
    clinic: { tenantId: actor.tenantId },
    clinicId,
  });
}

type Claim =
  | { kind: "claimed"; messageId: string }
  | { kind: "duplicate"; reason: string };

/**
 * Reserves one recipient for this template today, or says why it may not be
 * sent — the guard against duplicate messages.
 *
 * The check and the `sending` row it writes happen under a lock on the
 * account's tenant row, so no two requests can both pass the check for the
 * same person. That matters because a bulk send is one long request: it can
 * outlive the hosting proxy's timeout, the user then retries while the first
 * request is still working through the list on the server, and production
 * runs more than one app instance — an in-memory lock would see only half of
 * that. The lock is held for two statements, never across the gateway call.
 */
async function claimRecipient(
  tenantId: string,
  templateName: string,
  recipient: Pick<Recipient, "id" | "clinicId" | "mobileNumber">,
): Promise<Claim> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;

      const sent = await sentTemplateToday(tx, templateName, {
        clinic: { tenantId },
      });
      if (sent.patientIds.includes(recipient.id)) {
        return { kind: "duplicate", reason: ALREADY_SENT_TODAY_REASON } as const;
      }
      if (sent.mobileNumbers.includes(toWhatsappDigits(recipient.mobileNumber))) {
        return { kind: "duplicate", reason: SAME_NUMBER_SENT_TODAY_REASON } as const;
      }

      const row = await tx.whatsappMessage.create({
        data: {
          clinicId: recipient.clinicId,
          patientId: recipient.id,
          templateName,
          status: IN_FLIGHT_STATUS,
        },
        select: { id: true },
      });
      return { kind: "claimed", messageId: row.id } as const;
    },
    { maxWait: CLAIM_WAIT_MS, timeout: CLAIM_WAIT_MS },
  );
}

/**
 * True only when the gateway POSITIVELY reports no WhatsApp account.
 *
 * A check that could not be completed — gateway down, unexpected body — lets
 * the send proceed. Treating an inconclusive check as "no account" would
 * silently stop messaging real patients whenever the provider hiccuped, which
 * is a worse failure than one wasted send.
 */
async function isNotOnWhatsapp(
  to: string,
  config: import("@/lib/whatsapp").WhatsappConfig,
): Promise<boolean> {
  const check = await checkNumber(to, config);
  return check.checked && !check.exists;
}

/** One send's worth of who and what — everything `deliverTemplate` needs. */
export interface DeliveryTarget {
  /** The patient the row is filed against. Never null: the column is NOT NULL. */
  patientId: string;
  tenantId: string;
  clinicId: string;
  mobileNumber: string;
  values: TemplateValues;
  /**
   * The `sending` row `claimRecipient` reserved. When set, the outcome is
   * written onto that row instead of a new one, so one attempt stays one row.
   */
  claimedMessageId?: string;
}

export interface DeliveryOutcome {
  status: MessageStatus;
  /** The gateway's reason when it refused, shown verbatim. */
  failureReason: string | null;
}

/**
 * Renders one approved template, sends it, and records the attempt — AP-8.
 *
 * EXTRACTED FROM `sendToPatients`, NOT COPIED OUT OF IT. This is the whole body
 * of that function's per-recipient loop, unchanged: the same number
 * normalisation, the same not-on-WhatsApp pre-check, the same media/text
 * branch, the same swallowed row write. `sendToPatients` now calls it in a
 * loop and the appointment reminder calls it once, so there is exactly one
 * definition of what sending a template means — and a compliance rule added
 * here cannot be true of one path and not the other.
 *
 * CALLERS OWN AUTHORISATION. This function checks nothing: by the time it runs,
 * the caller has already proven the actor may send and that the clinic is
 * theirs. Kept unexported-looking on purpose in its own right — it is exported
 * only so lib/appointmentReminders.ts can reach it.
 */
export async function deliverTemplate(
  template: TemplateRecord,
  target: DeliveryTarget,
): Promise<DeliveryOutcome> {
  const message = renderTemplate(template.body, target.values);
  const to = toDigits(target.mobileNumber);
  const config = await resolveWhatsappConfigForClinic(
    target.tenantId,
    target.clinicId,
  );

  let outcome: SendResult;
  let usedMediaAssetId: string | null = null;
  if (!config) {
    outcome = {
      ok: false,
      providerMessageId: null,
      message:
        "WhatsApp is not configured for this clinic. Choose an organisation default or clinic device in Settings.",
    };
  } else if (to.length < 10) {
    // Short-circuited rather than sent: the gateway would reject it anyway,
    // and this reason is far more useful than its generic one.
    outcome = {
      ok: false,
      providerMessageId: null,
      message: `${target.mobileNumber} is not a valid WhatsApp number.`,
    };
  } else if (await isNotOnWhatsapp(to, config)) {
    // Checked before sending, not after failing. Repeatedly messaging numbers
    // with no WhatsApp account is one of the patterns that gets a sending
    // number flagged — and "not on WhatsApp" tells the front desk what to fix.
    outcome = {
      ok: false,
      providerMessageId: null,
      message: `${target.mobileNumber} is not on WhatsApp.`,
    };
  } else {
    // 1. Check for clinic-specific media attachment
    const templateMedia = await prisma.whatsappTemplateMedia.findUnique({
      where: {
        templateId_clinicId: {
          templateId: template.id,
          clinicId: target.clinicId,
        },
      },
      include: {
        mediaAsset: true,
      },
    });

    if (templateMedia?.mediaAsset && !templateMedia.mediaAsset.deletedAt) {
      const asset = templateMedia.mediaAsset;
      usedMediaAssetId = asset.id;
      try {
        const signedUrl =
          asset.mediaType === "DOCUMENT"
            ? buildDocumentContentUrl({
                mediaId: asset.id,
                tenantId: asset.tenantId,
                clinicId: target.clinicId,
                originalFileName: asset.originalFileName,
                purpose: "whatsapp",
              })
            : buildMediaContentUrl({
                mediaId: asset.id,
                tenantId: asset.tenantId,
                clinicId: target.clinicId,
                purpose: "whatsapp",
              });
        const mediaType: MediaType =
          asset.mediaType === "IMAGE"
            ? "image"
            : asset.mediaType === "VIDEO"
              ? "video"
              : "document";

        outcome = await sendMedia({
          to,
          message,
          footer: template.footer ?? undefined,
          mediaType,
          mediaUrl: signedUrl,
        }, config);
      } catch (mediaError: unknown) {
        console.error("Failed to prepare or send media template", mediaError);
        outcome = {
          ok: false,
          providerMessageId: null,
          message:
            mediaError instanceof MediaConfigurationError
              ? "Media service is not configured for WhatsApp sending."
              : "Failed to send media message.",
        };
      }
    } else if (template.mediaType && template.mediaUrl) {
      // 2. Fallback to legacy template media URL
      outcome = await sendMedia({
        to,
        message,
        footer: template.footer ?? undefined,
        mediaType: template.mediaType,
        mediaUrl: template.mediaUrl,
      }, config);
    } else {
      // 3. Fallback to text send
      outcome = await sendText({
        to,
        message,
        footer: template.footer ?? undefined,
      }, config);
    }
  }

  const status: MessageStatus = outcome.ok ? "sent" : "failed";

  try {
    const result = {
      mediaAssetId: usedMediaAssetId,
      whatsappDeviceId: config?.deviceId ?? null,
      senderNumber: config?.sender ?? null,
      status,
      providerMessageId: outcome.providerMessageId,
      failureReason: outcome.ok ? null : outcome.message,
    };

    if (target.claimedMessageId) {
      await prisma.whatsappMessage.update({
        where: { id: target.claimedMessageId },
        data: result,
      });
    } else {
      await prisma.whatsappMessage.create({
        data: {
          ...result,
          clinicId: target.clinicId,
          patientId: target.patientId,
          // Denormalised copy — see the schema note. History must survive the
          // template being renamed or deleted.
          templateName: template.name,
        },
      });
    }

    if (usedMediaAssetId && outcome.ok) {
      await prisma.mediaAsset
        .update({
          where: { id: usedMediaAssetId },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
    }
  } catch (error: unknown) {
    // The message may genuinely have gone out; losing the log row must not
    // turn that into an error on screen or stop the remaining recipients.
    console.error("Could not record WhatsApp message", error);
  }

  return { status, failureReason: outcome.ok ? null : outcome.message };
}

/**
 * Claims, then delivers, one recipient of a bulk send.
 *
 * The claim is taken immediately before the gateway call — not once for the
 * whole batch up front — because a batch can run for minutes and an
 * overlapping request may reach the same person in the meantime.
 */
async function sendOne(
  actor: ActorContext,
  template: TemplateRecord,
  recipient: Recipient,
  hasSentBefore: boolean,
): Promise<{ status: RecipientStatus; failureReason: string | null }> {
  let claim: Claim;
  try {
    claim = await claimRecipient(actor.tenantId, template.name, recipient);
  } catch (claimError: unknown) {
    // Fail closed: without a claim there is no proof this is not a duplicate.
    console.error(`Could not reserve WhatsApp send for recipient ${recipient.id}`, claimError);
    return {
      status: "failed",
      failureReason: "Could not start this send. Try again in a moment.",
    };
  }

  if (claim.kind === "duplicate") {
    return { status: "skipped", failureReason: claim.reason };
  }

  if (hasSentBefore) {
    await wait(DELAY_BETWEEN_SENDS_MS);
  }

  try {
    return await deliverTemplate(template, {
      patientId: recipient.id,
      tenantId: actor.tenantId,
      clinicId: recipient.clinicId,
      mobileNumber: recipient.mobileNumber,
      values: recipient.values,
      claimedMessageId: claim.messageId,
    });
  } catch (deliverError: unknown) {
    console.error(`Failed delivering template to recipient ${recipient.id}`, deliverError);
    const failureReason = "Failed to deliver message to this recipient.";
    // deliverTemplate only throws before the gateway call — its sends and row
    // write catch their own errors — so nothing went out: release the claim
    // as `failed`, which lets the front desk retry.
    await prisma.whatsappMessage
      .update({
        where: { id: claim.messageId },
        data: { status: "failed", failureReason },
      })
      .catch(() => {});
    return { status: "failed", failureReason };
  }
}

/**
 * FR-9.1 — renders one approved template per recipient and sends it.
 *
 * Every recipient gets its own `whatsapp_messages` row, written whether the
 * send succeeded or failed, so the history is a complete record of what was
 * attempted rather than only of what worked.
 *
 * A failure for one patient never stops the rest: the front desk sending to
 * twelve people should not lose eleven of them because one number is wrong.
 */
export async function sendToPatients(
  actor: ActorContext,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  // "May they send at all" — a clinic-scoped grant counts, and each patient's
  // own clinic is re-checked in loadRecipients before anything goes out.
  await assertCanSendSomewhere(actor);

  const template = await getTemplateForActor(actor, input.templateId);
  const recipients = await loadRecipients(actor, input.patientIds);

  if (recipients.length === 0) {
    throw new BadRequestError("None of those patients are available to you.");
  }

  // The order the front desk picked them in, so when two selected records share
  // a phone it is the first of them that gets the message.
  const order = new Map(input.patientIds.map((id, index) => [id, index]));
  const ordered = [...recipients].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  const results: RecipientResult[] = [];
  let hasSentBefore = false;

  for (const recipient of ordered) {
    // Re-checked per recipient rather than once for the batch: the ids come
    // from the client, and a patient's clinic is what decides the permission.
    await assertClinicInTenant(actor.tenantId, recipient.clinicId);

    const outcome = await sendOne(actor, template, recipient, hasSentBefore);
    if (outcome.status !== "skipped") hasSentBefore = true;

    results.push({
      patientId: recipient.id,
      patientName: recipient.name,
      patientCode: recipient.patientCode,
      status: outcome.status,
      failureReason: outcome.failureReason,
    });
  }

  const count = (status: RecipientStatus) =>
    results.filter((result) => result.status === status).length;

  return {
    templateName: template.name,
    sent: count("sent"),
    failed: count("failed"),
    skipped: count("skipped"),
    results,
  };
}

export interface MessageHistoryFilters {
  clinicId?: string;
  limit?: number;
  sentFrom?: Date;
  sentToExclusive?: Date;
}

/** FR-9.2 — what went out, newest first, scoped to the actor's clinics and date range. */
export async function listMessagesForActor(
  actor: ActorContext,
  options: MessageHistoryFilters = {},
): Promise<MessageRecord[]> {
  const access = await accessibleClinicScope(actor, "message:send");

  if (access.scope === "none") {
    throw new PermissionError("message:send");
  }

  const reachable =
    access.scope === "all"
      ? options.clinicId
        ? { clinicId: options.clinicId }
        : {}
      : {
          clinicId: {
            in: options.clinicId
              ? // A clinic outside the actor's reach narrows to nothing rather
                // than erroring — the rule the revenue report follows too.
                [...access.clinicIds].filter((id) => id === options.clinicId)
              : [...access.clinicIds],
          },
        };

  const dateFilter =
    options.sentFrom || options.sentToExclusive
      ? {
          sentAt: {
            ...(options.sentFrom ? { gte: options.sentFrom } : {}),
            ...(options.sentToExclusive ? { lt: options.sentToExclusive } : {}),
          },
        }
      : {};

  const rows = await prisma.whatsappMessage.findMany({
    where: { clinic: { tenantId: actor.tenantId }, ...reachable, ...dateFilter },
    orderBy: { sentAt: "desc" },
    take: options.limit ?? 100,
    select: {
      id: true,
      templateName: true,
      status: true,
      failureReason: true,
      providerMessageId: true,
      senderNumber: true,
      sentAt: true,
      clinic: { select: { name: true } },
      patient: { select: { name: true, patientCode: true, mobileNumber: true } },
    },
  });

  return rows.map(({ clinic, patient, ...row }) => ({
    ...row,
    clinicName: clinic.name,
    patientName: patient.name,
    patientCode: patient.patientCode,
    mobileNumber: patient.mobileNumber,
  }));
}
