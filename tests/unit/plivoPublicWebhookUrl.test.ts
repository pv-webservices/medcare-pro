import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
} from "@/lib/telephony/plivo";
import { resolvePlivoPublicWebhookUrl } from "@/lib/telephony/publicUrl";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const PUBLIC_ORIGIN = "https://medcare.example";
const INTERNAL_URL =
  "https://0.0.0.0:3000/api/webhooks/plivo/answer?attempt=1&source=provider";
const PUBLIC_URL =
  "https://medcare.example/api/webhooks/plivo/answer?attempt=1&source=provider";
const originalPublicOrigin = process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;

afterEach(() => {
  if (originalPublicOrigin === undefined) {
    delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
  } else {
    process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = originalPublicOrigin;
  }
});

describe("trusted Plivo public webhook URLs", () => {
  it("reconstructs the signed public URL from trusted origin and actual path/query", () => {
    expect(
      resolvePlivoPublicWebhookUrl(INTERNAL_URL, {
        publicOrigin: PUBLIC_ORIGIN,
        nodeEnv: "production",
      }),
    ).toBe(PUBLIC_URL);
  });

  it("accepts a public signature for an internal reverse-proxy request URL", async () => {
    process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = PUBLIC_ORIGIN;
    const request = buildSignedPlivoWebhookRequest({
      url: INTERNAL_URL,
      signatureUrl: PUBLIC_URL,
      headers: {
        Host: "attacker.example",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "http",
      },
    });

    expect(
      await verifyPlivoV3Webhook(request, TEST_PLIVO_AUTH_TOKEN),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["tampered pathname", `${PUBLIC_ORIGIN}/api/webhooks/plivo/input?attempt=1&source=provider`],
    ["tampered query", `${PUBLIC_ORIGIN}/api/webhooks/plivo/answer?attempt=2&source=provider`],
  ])("rejects a signature with a %s", async (_label, signatureUrl) => {
    process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = PUBLIC_ORIGIN;
    const request = buildSignedPlivoWebhookRequest({
      url: INTERNAL_URL,
      signatureUrl,
    });

    expect(
      await verifyPlivoV3Webhook(request, TEST_PLIVO_AUTH_TOKEN),
    ).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a wrong signature", async () => {
    process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = PUBLIC_ORIGIN;
    const request = buildSignedPlivoWebhookRequest({
      url: INTERNAL_URL,
      signatureUrl: PUBLIC_URL,
      headers: { "X-Plivo-Signature-V3": "wrong-signature" },
    });

    expect(
      await verifyPlivoV3Webhook(request, TEST_PLIVO_AUTH_TOKEN),
    ).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("requires a configured origin in production", () => {
    expect(() =>
      resolvePlivoPublicWebhookUrl(INTERNAL_URL, {
        publicOrigin: null,
        nodeEnv: "production",
      }),
    ).toThrow("PLIVO_PUBLIC_WEBHOOK_ORIGIN is required in production");
  });

  it.each([
    "http://medcare.example",
    "https://user:password@medcare.example",
    "https://medcare.example/webhooks",
    "https://medcare.example?source=provider",
    "https://medcare.example#fragment",
  ])("fails closed for an unsafe production origin: %s", (publicOrigin) => {
    expect(() =>
      resolvePlivoPublicWebhookUrl(INTERNAL_URL, {
        publicOrigin,
        nodeEnv: "production",
      }),
    ).toThrow();
  });

  it("uses the same trusted origin for input and stateful action URLs", () => {
    process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = `${PUBLIC_ORIGIN}/`;

    expect(buildPlivoInputActionUrl(INTERNAL_URL)).toBe(
      `${PUBLIC_ORIGIN}/api/webhooks/plivo/input`,
    );
    expect(
      buildPlivoActionUrl(INTERNAL_URL, "/api/webhooks/plivo/information", {
        page: 2,
      }),
    ).toBe(`${PUBLIC_ORIGIN}/api/webhooks/plivo/information?page=2`);
  });
});
