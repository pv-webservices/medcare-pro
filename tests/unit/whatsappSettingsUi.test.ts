import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/components/settings/WhatsappProviderSettings.tsx"), "utf8");
describe("WhatsApp owner settings polling", () => {
  it("uses bounded polling and clears it on connection, timeout, and modal cleanup", () => {
    expect(source).toContain("attempts > 30");
    expect(source.match(/clearInterval\(timer\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("return () => window.clearInterval(timer)");
  });
  it("does not expose or submit provider credentials", () => {
    expect(source).not.toContain("apiKey");
    expect(source).not.toContain("encryptedApiKey");
  });
});
