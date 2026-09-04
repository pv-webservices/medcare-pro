import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/components/settings/WhatsappProviderSettings.tsx"), "utf8");
describe("WhatsApp owner settings polling", () => {
  it("uses bounded polling and clears it on connection, timeout, and modal cleanup", () => {
    expect(source).toContain("}, 2000)");
    expect(source).toContain("attempts > 30");
    expect(source.match(/clearInterval\(timer\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("return () => window.clearInterval(timer)");
  });
  it("transitions the connect and reconnect flows to the required QR view", () => {
    expect(source).toContain('title="Scan this QR using WhatsApp"');
    expect(source).toContain('alt="WhatsApp connection QR code"');
  });
  it("does not expose or submit provider credentials", () => {
    expect(source).not.toContain("apiKey");
    expect(source).not.toContain("encryptedApiKey");
  });
  it("counts all configured rows and separates initial webhook setup from regeneration", () => {
    expect(source).toContain("account.devices.length} of {account.deviceLimit} device slots are in use.");
    expect(source).not.toContain("account.devices.filter((device) => device.enabled).length");
    expect(source).toContain('act("setupWebhook")');
    expect(source).toContain("Regenerate webhook URL");
    expect(source).toContain("Webhook configured.");
    expect(source).toContain("navigator.clipboard.writeText(webhookUrl)");
    expect(source).toContain("for this exact device in RkvRobo");
  });
  it("labels operational device states and the last provider check", () => {
    expect(source).toContain("RkvRobo could not confirm this device's state.");
    expect(source).toContain("A confirmed QR session is waiting to be scanned.");
    expect(source).toContain("Not found in RkvRobo");
    expect(source).toContain("Last checked:");
    expect(source).toContain("Connect WhatsApp</Button>");
  });
  it("separates reconnect from add-new and leaves reconnect available at capacity", () => {
    expect(source).toContain('action: "reconnect"');
    expect(source).toContain('disabled={availableAccounts.length === 0}');
    expect(source).toContain("Reconnect as this device");
  });
  it("uses an accessible guided removal modal and a boxed lucide close target", () => {
    expect(source).toContain("Remove WhatsApp device");
    expect(source).toContain("Organisation primary");
    expect(source).toContain("Reassign routing to another eligible device");
    expect(source).toContain("Clear these assignments");
    expect(source).toContain('variant="dangerSolid"');
    expect(source).toContain('aria-label="Close"');
    expect(source).toContain('<X aria-hidden="true" className="h-5 w-5" />');
    expect(source).toContain("h-10 w-10");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("event.preventDefault()");
  });
});
