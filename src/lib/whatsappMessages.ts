import { z } from "zod";
import { BadRequestError } from "@/lib/apiHandler";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { formatClockTime, formatDateOnly } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  assertClinicInTenant,
  PermissionError,
  type ActorContext,
} from "@/lib/rbac";
import {
  isWhatsappConfigured,
  sendMedia,
  sendText,
  WhatsappNotConfiguredError,
  type SendResult,
} from "@/lib/whatsapp";
import {
  assertCanSendSomewhere,
  getTemplateForActor,
  renderTemplate,
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

/** One request should not hold a connection open for an unbounded batch. */
const MAX_RECIPIENTS = 50;

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

export interface RecipientResult {
  patientId: string;
  patientName: string;
  patientCode: string;
  status: MessageStatus;
  /** The gateway's reason when it refused, shown verbatim. */
  failureReason: string | null;
}

export interface SendMessageResult {
  templateName: string;
  sent: number;
  failed: number;
  results: RecipientResult[];
}

export interface MessageRecord {
  id: string;
  templateName: string;
  status: string;
  failureReason: string | null;
  providerMessageId: string | null;
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

function toDigits(mobileNumber: string): string {
  // The gateway wants digits only, e.g. 919812345678. Anything the front desk
  // typed for readability — spaces, +, hyphens, brackets — is stripped.
  return mobileNumber.replace(/\D/g, "");
}

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

  if (!isWhatsappConfigured()) {
    throw new WhatsappNotConfiguredError();
  }

  const template = await getTemplateForActor(actor, input.templateId);
  const recipients = await loadRecipients(actor, input.patientIds);

  if (recipients.length === 0) {
    throw new BadRequestError("None of those patients are available to you.");
  }

  const results: RecipientResult[] = [];

  for (const [index, recipient] of recipients.entries()) {
    // Re-checked per recipient rather than once for the batch: the ids come
    // from the client, and a patient's clinic is what decides the permission.
    await assertClinicInTenant(actor.tenantId, recipient.clinicId);

    const message = renderTemplate(template.body, recipient.values);
    const to = toDigits(recipient.mobileNumber);

    let outcome: SendResult;
    if (to.length < 10) {
      // Short-circuited rather than sent: the gateway would reject it anyway,
      // and this reason is far more useful than its generic one.
      outcome = {
        ok: false,
        providerMessageId: null,
        message: `${recipient.mobileNumber} is not a valid WhatsApp number.`,
      };
    } else if (template.mediaType && template.mediaUrl) {
      outcome = await sendMedia({
        to,
        message,
        footer: template.footer ?? undefined,
        mediaType: template.mediaType,
        mediaUrl: template.mediaUrl,
      });
    } else {
      outcome = await sendText({
        to,
        message,
        footer: template.footer ?? undefined,
      });
    }

    const status: MessageStatus = outcome.ok ? "sent" : "failed";

    try {
      await prisma.whatsappMessage.create({
        data: {
          clinicId: recipient.clinicId,
          patientId: recipient.id,
          // Denormalised copy — see the schema note. History must survive the
          // template being renamed or deleted.
          templateName: template.name,
          status,
          providerMessageId: outcome.providerMessageId,
          failureReason: outcome.ok ? null : outcome.message,
        },
      });
    } catch (error: unknown) {
      // The message may genuinely have gone out; losing the log row must not
      // turn that into an error on screen or stop the remaining recipients.
      console.error("Could not record WhatsApp message", error);
    }

    results.push({
      patientId: recipient.id,
      patientName: recipient.name,
      patientCode: recipient.patientCode,
      status,
      failureReason: outcome.ok ? null : outcome.message,
    });

    if (index < recipients.length - 1) {
      await wait(DELAY_BETWEEN_SENDS_MS);
    }
  }

  return {
    templateName: template.name,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

/** FR-9.2 — what went out, newest first, scoped to the actor's clinics. */
export async function listMessagesForActor(
  actor: ActorContext,
  options: { clinicId?: string; limit?: number } = {},
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

  const rows = await prisma.whatsappMessage.findMany({
    where: { clinic: { tenantId: actor.tenantId }, ...reachable },
    orderBy: { sentAt: "desc" },
    take: options.limit ?? 100,
    select: {
      id: true,
      templateName: true,
      status: true,
      failureReason: true,
      providerMessageId: true,
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
