import { z } from "zod";
const s3Schema = z.object({
  endpoint: z.url().refine((v) => new URL(v).protocol === "https:"),
  region: z.string().trim().min(1),
  bucket: z.string().trim().min(3).max(255),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
  forcePathStyle: z.boolean(),
  serverSideEncryption: z.enum(["AES256", "aws:kms"]),
});
export function getClinicalAudioConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.CLINICAL_AUDIO_ENABLED !== "true") return null;
  const config = z
    .object({
      storageProvider: z.enum(["s3", "memory", "local"]),
      maxMinutes: z.coerce.number().int().min(1).max(120),
      maxBytes: z.coerce.number().int().min(1024).max(2_147_483_647),
      signedUrlTtlSeconds: z.coerce.number().int().min(30).max(300),
      retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    })
    .safeParse({
      storageProvider: env.RECORDING_STORAGE_PROVIDER,
      maxMinutes: env.CLINICAL_RECORDING_MAX_MINUTES || 120,
      maxBytes: env.CLINICAL_RECORDING_MAX_BYTES || 536870912,
      signedUrlTtlSeconds: env.RECORDING_SIGNED_URL_TTL_SECONDS || 300,
      retentionDays: env.RECORDING_AUDIO_RETENTION_DAYS || undefined,
    });
  if (
    !config.success ||
    (env.NODE_ENV === "production" && config.data.storageProvider !== "s3")
  )
    return null;
  const s3 = s3Schema.safeParse({
    endpoint: env.RECORDING_S3_ENDPOINT,
    region: env.RECORDING_S3_REGION,
    bucket: env.RECORDING_S3_BUCKET,
    accessKeyId: env.RECORDING_S3_ACCESS_KEY_ID,
    secretAccessKey: env.RECORDING_S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.RECORDING_S3_FORCE_PATH_STYLE === "true",
    serverSideEncryption: env.RECORDING_S3_SERVER_SIDE_ENCRYPTION || "AES256",
  });
  if (config.data.storageProvider === "s3" && !s3.success) return null;
  return {
    ...config.data,
    s3: s3.success ? s3.data : null,
    localRoot: env.RECORDING_LOCAL_ROOT || ".private_clinical_audio",
    localSecret:
      env.RECORDING_LOCAL_SIGNING_SECRET ||
      "development-only-clinical-audio-signing",
  };
}
export type ClinicalAudioConfig = NonNullable<
  ReturnType<typeof getClinicalAudioConfig>
>;
