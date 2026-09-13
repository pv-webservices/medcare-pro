import { z } from "zod";
import type { AiConfig } from "../config";
import { AiError } from "../errors";
import type { AiProvider, AiRequest, AiProviderResult } from "../types";
const envelope = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.literal("STOP"),
        content: z.object({
          parts: z
            .array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
              }),
            )
            .max(32),
        }),
      }),
    )
    .length(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export class GeminiProvider implements AiProvider {
  constructor(
    private readonly config: AiConfig,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async generateStructured<T>(
    request: AiRequest,
  ): Promise<AiProviderResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.transport(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.systemInstruction }] },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: JSON.stringify({
                      task: request.task,
                      input: request.input,
                    }),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4096,
              responseFormat: {
                text: { mimeType: "application/json", schema: request.schema },
              },
            },
          }),
        },
      );
      if (!response.ok)
        throw new AiError(
          response.status === 429
            ? "QUOTA"
            : [401, 403].includes(response.status)
              ? "AUTH"
              : [400, 404].includes(response.status)
                ? "MODEL"
                : "NETWORK",
        );
      // Bound the transport body, including chunked responses. Do not read/log error bodies.
      const reader = response.body?.getReader();
      if (!reader) throw new AiError("INVALID_OUTPUT");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 100000) {
          await reader.cancel();
          throw new AiError("INVALID_OUTPUT");
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const parsed = envelope.safeParse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!parsed.success) throw new AiError("INVALID_OUTPUT");
      const text = parsed.data.candidates[0].content.parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      return {
        output: JSON.parse(text) as T,
        inputTokens: parsed.data.usageMetadata?.promptTokenCount,
        outputTokens: parsed.data.usageMetadata?.candidatesTokenCount,
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(
        controller.signal.aborted
          ? "TIMEOUT"
          : error instanceof SyntaxError
            ? "INVALID_OUTPUT"
            : "NETWORK",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
