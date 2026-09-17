// Test-runner preload only. Never imported by application code or builds.
const database = new URL(process.env.DATABASE_URL || "mysql://invalid");
if (
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  !database.pathname.startsWith("/medcare_ep") ||
  process.env.GEMINI_API_KEY !== "synthetic-e2e-never-sent"
)
  throw new Error(
    "AI E2E mock requires disposable local database and synthetic credentials.",
  );
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://api.sarvam.ai/"))
    throw new Error("Live Sarvam transport is forbidden in automated E2E.");
  if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
    const payload = JSON.parse(options.body);
    const { input } = JSON.parse(payload.contents[0].parts[0].text);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (input.text.includes("Synthetic provider failure"))
      return new Response("synthetic failure", { status: 500 });
    const suggestedText = input.text.includes("500 mg")
      ? input.text.replace("500 mg", "850 mg")
      : input.text.replace(/\bsever\b/g, "severe");
    const originalFragment = input.text.includes("500 mg")
      ? "500 mg"
      : "sever";
    const suggestedFragment = input.text.includes("500 mg")
      ? "850 mg"
      : "severe";
    const output = {
      changed: suggestedText !== input.text,
      suggestedText,
      suggestions:
        suggestedText === input.text
          ? []
          : [
              {
                category: input.mode,
                originalFragment,
                suggestedFragment,
                reason: "Synthetic provider-contract correction",
                confidence: "HIGH",
              },
            ],
    };
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(output) }] },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  return originalFetch(url, options);
};
