import { z } from "zod";

const schema = z.object({
  enabled: z.literal("true"),
  storageProvider: z.enum(["s3", "memory", "local"]),
  maxMinutes: z.coerce.number().int().min(1).max(24 * 60),
  maxBytes: z.coerce.number().int().positive().optional(),
  retentionDays: z.coerce.number().int().positive().optional(),
});

export function getClinicalAudioConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = schema.safeParse({
    enabled: env.CLINICAL_AUDIO_ENABLED,
    storageProvider: env.RECORDING_STORAGE_PROVIDER,
    maxMinutes: env.CLINICAL_RECORDING_MAX_MINUTES || 120,
    maxBytes: env.CLINICAL_RECORDING_MAX_BYTES || undefined,
    retentionDays: env.RECORDING_AUDIO_RETENTION_DAYS || undefined,
  });
  if (!parsed.success) return null;
  if (env.NODE_ENV === "production" && parsed.data.storageProvider !== "s3") return null;
  return parsed.data;
}

export type ClinicalAudioConfig = NonNullable<ReturnType<typeof getClinicalAudioConfig>>;
