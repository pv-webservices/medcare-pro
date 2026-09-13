import { getAiConfig } from "./config";
import { AiError } from "./errors";
import { GeminiProvider } from "./providers/gemini";
import type { AiProvider } from "./types";
export function getAiProvider(): AiProvider {
  const config = getAiConfig();
  if (!config) throw new AiError("DISABLED");
  return new GeminiProvider(config);
}
