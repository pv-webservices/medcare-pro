import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findDevice: vi.fn(), updateMessages: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsappDevice: { findUnique: mocks.findDevice }, whatsappMessage: { updateMany: mocks.updateMessages } } }));
vi.mock("@/lib/whatsappDeviceManagement", async () => {
  const crypto = await import("node:crypto");
  return { hashWhatsappWebhookSecret: (secret: string) => crypto.createHash("sha256").update(secret).digest("hex") };
});

import { createHash } from "node:crypto";
import { POST } from "@/app/api/whatsapp/webhook/[publicId]/route";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function request(token: string, payload: object = { event: "ack", message_id: "message-a", status: "delivered" }) {
  return new Request(`https://app.test/api/whatsapp/webhook/public-a?token=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

describe("per-device WhatsApp webhook", () => {
  beforeEach(() => vi.clearAllMocks());
  it("accepts only the matching public id and secret and scopes the message update to that device", async () => {
    mocks.findDevice.mockResolvedValue({ id: "device-a", phoneNumber: "919111111111", webhookSecretHash: hash("secret-a") });
    const response = await POST(request("secret-a"), { params: Promise.resolve({ publicId: "public-a" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateMessages).toHaveBeenCalledWith(expect.objectContaining({ where: { providerMessageId: "message-a", whatsappDeviceId: "device-a" } }));
  });
  it.each(["secret-b", "tampered"])("rejects mismatched secret %s", async (secret) => {
    mocks.findDevice.mockResolvedValue({ id: "device-a", phoneNumber: "919111111111", webhookSecretHash: hash("secret-a") });
    expect((await POST(request(secret), { params: Promise.resolve({ publicId: "public-a" }) })).status).toBe(401);
    expect(mocks.updateMessages).not.toHaveBeenCalled();
  });
  it("rejects unknown public ids and claimed device mismatches", async () => {
    mocks.findDevice.mockResolvedValueOnce(null);
    expect((await POST(request("secret-a"), { params: Promise.resolve({ publicId: "unknown" }) })).status).toBe(401);
    mocks.findDevice.mockResolvedValueOnce({ id: "device-a", phoneNumber: "919111111111", webhookSecretHash: hash("secret-a") });
    expect((await POST(request("secret-a", { device: "919222222222", event: "ack", message_id: "message-a" }), { params: Promise.resolve({ publicId: "public-a" }) })).status).toBe(403);
  });
});
