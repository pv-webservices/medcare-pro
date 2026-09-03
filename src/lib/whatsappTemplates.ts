import { z } from "zod";
import { ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  PermissionError,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import { MEDIA_TYPES, type MediaType } from "@/lib/whatsapp";
import {
  MAX_BODY_LENGTH,
  unknownPlaceholders,
  usedPlaceholders,
  type TemplatePlaceholder,
} from "@/lib/whatsappTemplateText";

/**
 * The account's approved message set — FR-9.1.
 *
 * RkvRobo is not an official BSP and has no template approval of its own, so
 * "approved" means "written here first". Every send names one of these rows;
 * no endpoint in the app accepts a free-text body. That is a weaker guarantee
 * than a BSP's review — an Admin can write anything into a template — but it
 * keeps outbound traffic to a small reviewed set rather than whatever someone
 * types at the front desk, which is what actually gets a number flagged.
 *
 * Templates are ACCOUNT-scoped: one business writes its wording once and every
 * clinic under it sends the same approved text.
 *
 * Two permissions, deliberately split:
 *   `message:template` — write the wording (an admin task)
 *   `message:send`     — send it to a patient (a front-desk task)
 * A receptionist who can send should not be able to rewrite what gets sent.
 */

// The wording helpers themselves live in @/lib/whatsappTemplateText, which the
// client composer also imports for its live preview — this module cannot be
// imported from a client component because it touches Prisma.
export {
  PLACEHOLDER_LABELS,
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
  unknownPlaceholders,
  type TemplatePlaceholder,
  type TemplateValues,
} from "@/lib/whatsappTemplateText";

const mediaTypeSchema = z.enum(MEDIA_TYPES);

const baseTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name is required.")
    .max(120)
    // Kept to a slug so the name reads the same in the history table, the API
    // and the gateway's own logs.
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/,
      "Use letters, numbers, spaces, hyphens and underscores only.",
    ),
  body: z
    .string()
    .trim()
    .min(1, "Message body is required.")
    .max(MAX_BODY_LENGTH),
  footer: z.string().trim().max(255).optional().or(z.literal("")),
  mediaType: mediaTypeSchema.optional().or(z.literal("")),
  mediaUrl: z.url("Enter a direct link to the file.").max(2000).optional().or(z.literal("")),
});

/**
 * Media needs both halves or neither, and the body must not reference a
 * placeholder nothing can fill.
 */
function refineTemplate<T extends z.ZodType>(schema: T) {
  return schema
    .refine(
      (value: unknown) => {
        const input = value as { mediaType?: string; mediaUrl?: string };
        const hasType = Boolean(input.mediaType);
        const hasUrl = Boolean(input.mediaUrl);
        return hasType === hasUrl;
      },
      { message: "Give both a media type and a media link, or neither." },
    )
    .refine(
      (value: unknown) => {
        const input = value as { body?: string };
        return input.body === undefined || unknownPlaceholders(input.body).length === 0;
      },
      {
        message:
          "The body uses a placeholder that cannot be filled. Check the list of available placeholders.",
      },
    );
}

export const createTemplateSchema = refineTemplate(baseTemplateSchema);

export const updateTemplateSchema = refineTemplate(
  baseTemplateSchema.partial().extend({
    templateId: z.string().trim().min(1).max(64),
  }),
);

export const deleteTemplateSchema = z.object({
  templateId: z.string().trim().min(1).max(64),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export interface TemplateRecord {
  id: string;
  name: string;
  body: string;
  footer: string | null;
  mediaType: MediaType | null;
  mediaUrl: string | null;
  /** Which placeholders this body actually uses, for the UI's preview. */
  placeholders: TemplatePlaceholder[];
  clinicMediaAsset?: import("@/lib/mediaTypes").SafeMediaAsset | null;
}

function toRecord(row: {
  id: string;
  name: string;
  body: string;
  footer: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  clinicMedia?: Array<{
    mediaAsset?: import("@/lib/mediaTypes").SafeMediaAsset | null;
  }>;
}): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    footer: row.footer,
    // Read back defensively: the column is a plain string, and a row written
    // before a type was removed from MEDIA_TYPES must not crash the page.
    mediaType: (MEDIA_TYPES as readonly string[]).includes(row.mediaType ?? "")
      ? (row.mediaType as MediaType)
      : null,
    mediaUrl: row.mediaUrl,
    placeholders: usedPlaceholders(row.body),
    clinicMediaAsset: row.clinicMedia?.[0]?.mediaAsset ?? null,
  };
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  body: true,
  footer: true,
  mediaType: true,
  mediaUrl: true,
} as const;

/** Empty strings from an HTML form mean "not set", which is null in the database. */
function emptyToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Throws PermissionError (→ 403) unless the actor may send SOMEWHERE.
 *
 * `requirePermission(actor, "message:send")` is deliberately not used: with no
 * clinic id it insists on an account-wide grant, which would lock out the
 * clinic-scoped front-desk user who does most of the sending. Templates are
 * account-scoped objects, so the question is "may this person send at all",
 * not "may they send in clinic X" — the per-patient clinic check happens later,
 * at the point a message actually goes somewhere.
 */
export async function assertCanSendSomewhere(actor: ActorContext): Promise<void> {
  const access = await accessibleClinicScope(actor, "message:send");

  if (access.scope === "none") {
    throw new PermissionError("message:send");
  }
}

/**
 * Anyone who may send needs to read the list to choose from it, so this asks
 * for `message:send` rather than the stricter authoring permission.
 */
export async function listTemplatesForActor(
  actor: ActorContext,
  clinicId?: string | null,
): Promise<TemplateRecord[]> {
  await assertCanSendSomewhere(actor);

  if (clinicId) {
    const rows = await prisma.whatsappTemplate.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: {
        ...TEMPLATE_SELECT,
        clinicMedia: {
          where: { clinicId },
          select: {
            mediaAsset: {
              select: {
                id: true,
                clinicId: true,
                originalFileName: true,
                mimeType: true,
                mediaType: true,
                fileSize: true,
                createdAt: true,
                lastUsedAt: true,
              },
            },
          },
        },
      },
    });

    return rows.map(toRecord);
  }

  const rows = await prisma.whatsappTemplate.findMany({
    where: { tenantId: actor.tenantId },
    orderBy: { name: "asc" },
    select: TEMPLATE_SELECT,
  });

  return rows.map(toRecord);
}

/** Scoped by tenant: another account's template id must not resolve. */
export async function getTemplateForActor(
  actor: ActorContext,
  templateId: string,
  clinicId?: string | null,
): Promise<TemplateRecord> {
  if (clinicId) {
    const row = await prisma.whatsappTemplate.findFirst({
      where: { id: templateId, tenantId: actor.tenantId },
      select: {
        ...TEMPLATE_SELECT,
        clinicMedia: {
          where: { clinicId },
          select: {
            mediaAsset: {
              select: {
                id: true,
                clinicId: true,
                originalFileName: true,
                mimeType: true,
                mediaType: true,
                fileSize: true,
                createdAt: true,
                lastUsedAt: true,
              },
            },
          },
        },
      },
    });

    if (!row) {
      // 404, not 403 — another account's id must not be confirmable.
      throw new ScopeError();
    }

    return toRecord(row);
  }

  const row = await prisma.whatsappTemplate.findFirst({
    where: { id: templateId, tenantId: actor.tenantId },
    select: TEMPLATE_SELECT,
  });

  if (!row) {
    // 404, not 403 — another account's id must not be confirmable.
    throw new ScopeError();
  }

  return toRecord(row);
}

export async function createTemplate(
  actor: ActorContext,
  input: CreateTemplateInput,
): Promise<TemplateRecord> {
  await requirePermission(actor, "message:template");

  try {
    const row = await prisma.whatsappTemplate.create({
      data: {
        // From the session, never from the request body.
        tenantId: actor.tenantId,
        name: input.name,
        body: input.body,
        footer: emptyToNull(input.footer) ?? null,
        mediaType: emptyToNull(input.mediaType) ?? null,
        mediaUrl: emptyToNull(input.mediaUrl) ?? null,
      },
      select: TEMPLATE_SELECT,
    });

    return toRecord(row);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A template with that name already exists.");
    }
    throw error;
  }
}

export async function updateTemplate(
  actor: ActorContext,
  input: UpdateTemplateInput,
): Promise<TemplateRecord> {
  await requirePermission(actor, "message:template");

  // Confirms ownership before the write; throws ScopeError (→ 404) otherwise.
  await getTemplateForActor(actor, input.templateId);

  try {
    const row = await prisma.whatsappTemplate.update({
      where: { id: input.templateId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.footer === undefined ? {} : { footer: emptyToNull(input.footer) }),
        ...(input.mediaType === undefined
          ? {}
          : { mediaType: emptyToNull(input.mediaType) }),
        ...(input.mediaUrl === undefined
          ? {}
          : { mediaUrl: emptyToNull(input.mediaUrl) }),
      },
      select: TEMPLATE_SELECT,
    });

    return toRecord(row);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A template with that name already exists.");
    }
    throw error;
  }
}

/**
 * Deleting a template does not touch the messages sent from it —
 * `whatsapp_messages.template_name` is a denormalised copy, so history stays
 * readable afterwards.
 */
export async function deleteTemplate(
  actor: ActorContext,
  templateId: string,
): Promise<{ removed: true }> {
  await requirePermission(actor, "message:template");
  await getTemplateForActor(actor, templateId);

  await prisma.whatsappTemplate.delete({ where: { id: templateId } });

  return { removed: true };
}
