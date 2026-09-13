import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { AiError } from "@/lib/ai/errors";
const config = {
  provider: "gemini" as const,
  apiKey: "synthetic-key",
  model: "synthetic-model",
  timeoutMs: 10,
};
const request = {
  task: "test",
  systemInstruction: "test",
  input: "synthetic",
  schema: {},
};
describe("Gemini transport (mock only)", () => {
  it("requests JSON schema with server header credentials and collects numeric usage", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: '{"changed":false}' }] },
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
        ),
      );
    const response = await new GeminiProvider(
      config,
      transport,
    ).generateStructured(request);
    expect(response).toEqual({
      output: { changed: false },
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(transport.mock.calls[0][0]).not.toContain("synthetic-key");
    expect(
      JSON.parse(transport.mock.calls[0][1].body).generationConfig
        .responseFormat.text.mimeType,
    ).toBe("application/json");
  });
  it.each([
    [401, "AUTH"],
    [403, "AUTH"],
    [429, "QUOTA"],
    [404, "MODEL"],
    [500, "NETWORK"],
  ])("sanitizes status %s", async (status, code) => {
    await expect(
      new GeminiProvider(
        config,
        vi
          .fn()
          .mockResolvedValue(
            new Response("PHI SECRET", { status: Number(status) }),
          ),
      ).generateStructured(request),
    ).rejects.toMatchObject({ code });
  });
  it.each([
    "invalid JSON",
    JSON.stringify({ candidates: [] }),
    JSON.stringify({
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } },
      ],
    }),
    JSON.stringify({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } },
      ],
    }),
    "x".repeat(100001),
  ])(
    "rejects malformed/truncated/bounded responses",
    async (body) =>
      await expect(
        new GeminiProvider(
          config,
          vi.fn().mockResolvedValue(new Response(body)),
        ).generateStructured(request),
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT" }),
  );
  it("sanitizes network errors", async () => {
    const error = await new GeminiProvider(
      config,
      vi.fn().mockRejectedValue(new Error("PHI SECRET")),
    )
      .generateStructured(request)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.message).not.toContain("SECRET");
  });
  it("aborts on timeout", async () => {
    const transport = vi.fn(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    await expect(
      new GeminiProvider(config, transport as typeof fetch).generateStructured(
        request,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
