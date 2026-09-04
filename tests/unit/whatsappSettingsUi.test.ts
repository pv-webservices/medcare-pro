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
  it("counts all configured rows and separates initial webhook setup from regeneration", () => {
    expect(source).toContain("account.devices.length} of {account.deviceLimit}");
    expect(source).not.toContain("account.devices.filter((device) => device.enabled).length");
    expect(source).toContain('act("setupWebhook")');
    expect(source).toContain("Regenerate webhook URL");
    expect(source).toContain("Webhook configured.");
    expect(source).toContain("navigator.clipboard.writeText(webhookUrl)");
    expect(source).toContain("for this exact device in RkvRobo");
  });
  it("labels operational device states and the last provider check", () => {
    expect(source).toContain("Status has not been confirmed.");
    expect(source).toContain("Waiting for WhatsApp connection.");
    expect(source).toContain("Last checked:");
    expect(source).toContain("Connect WhatsApp</Button>");
  });
});
