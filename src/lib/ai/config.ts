import { z } from "zod";
const configuration = z.object({
  provider: z.literal("gemini"),
  apiKey: z.string().trim().min(1),
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/),
  timeoutMs: z.coerce.number().int().min(1000).max(30000),
});
export function getAiConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.AI_ENABLED !== "true") return null;
  const parsed = configuration.safeParse({
    provider: env.AI_PROVIDER,
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    timeoutMs: env.GEMINI_TIMEOUT_MS || 15000,
  });
  return parsed.success ? parsed.data : null;
}
export type AiConfig = NonNullable<ReturnType<typeof getAiConfig>>;
