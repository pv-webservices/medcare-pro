import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDevice, generateDeviceQr, getDeviceStatus, isWhatsappDeviceNotFoundMessage, logoutDevice, sendText, type WhatsappConfig } from "@/lib/whatsapp";

const config: WhatsappConfig = {
  apiKey: "tenant-key",
  baseUrl: "https://provider.test/api",
  sender: "918920847457",
};

function response(body: unknown, init: { status?: number; contentType?: string } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

function postedBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("RkvRobo device adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { status: "qr-ready", qr: "top-qr" },
    { status: 0, qrcode: "top-qrcode" },
    { status: "pending", qr_code: "top-qr-code" },
    { status: false, data: { qr: "nested-qr" } },
    { status: false, data: { qrcode: "nested-qrcode" } },
    { status: false, data: { qr_code: "nested-qr-code" } },
  ])("accepts usable QR material despite unusual generate-qr status: $status", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(generateDeviceQr(config, config.sender)).resolves.toMatchObject({ ok: true, qr: expect.any(String) });
  });

  it("accepts the current documented QR-ready response with status=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      status: false,
      qrcode: "data:image/png;base64,safe-test-qr",
      message: "Please scann qrcode",
    })));

    await expect(generateDeviceQr(config, config.sender)).resolves.toEqual({
      ok: true,
      qr: "data:image/png;base64,safe-test-qr",
      message: "Please scann qrcode",
    });
  });

  it("sends exact endpoint-specific device payloads without generic sender injection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: true, info: [{ device: config.sender, status: "Connected" }] }))
      .mockResolvedValueOnce(response({ status: true, qr: "safe-qr" }))
      .mockResolvedValueOnce(response({ status: true }))
      .mockResolvedValueOnce(response({ status: true }));
    vi.stubGlobal("fetch", fetchMock);
    await getDeviceStatus(config);
    await generateDeviceQr(config, config.sender);
    await logoutDevice(config);
    await deleteDevice(config);
    expect(postedBody(fetchMock, 0)).toEqual({ api_key: "tenant-key" });
    expect(postedBody(fetchMock, 1)).toEqual({ api_key: "tenant-key", device: config.sender, force: true });
    expect(typeof postedBody(fetchMock, 1).force).toBe("boolean");
    expect(postedBody(fetchMock, 1)).not.toHaveProperty("sender");
    expect(fetchMock.mock.calls[1][0]).toBe("https://provider.test/api/generate-qr");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    expect(postedBody(fetchMock, 2)).toEqual({ api_key: "tenant-key", sender: config.sender });
    expect(postedBody(fetchMock, 3)).toEqual({ api_key: "tenant-key", sender: config.sender });
  });

  it("preserves the verified send-message sender payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: true, msg: "sent" }));
    vi.stubGlobal("fetch", fetchMock);
    await sendText({ to: "919111111111", message: "hello" }, config);
    expect(postedBody(fetchMock)).toEqual({
      api_key: "tenant-key",
      sender: config.sender,
      full: 1,
      number: "919111111111",
      message: "hello",
    });
  });

  it("classifies an explicit provider rejection as definitive", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: false, msg: "Invalid device" }, { status: 400 })));
    await expect(generateDeviceQr(config, config.sender)).resolves.toEqual({ ok: false, definitive: true, message: "Invalid device" });
  });

  it("classifies a non-JSON QR response as ambiguous and does not consume its content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("data:image/png;base64,not-confirmed-by-docs", { contentType: "text/plain" })));
    const result = await generateDeviceQr(config, config.sender);
    expect(result).toEqual({
      ok: false,
      definitive: false,
      message: expect.stringContaining("[generate-qr status=200 contentType=text/plain length="),
    });
    expect(result.message).toContain("keys=none hasQr=false classification=UNREADABLE");
    expect(result.message).not.toContain("not-confirmed-by-docs");
    expect(result.message).not.toContain(config.apiKey);
    expect(result.message).not.toContain(config.sender);
  });

  it("selects the requested device rather than another account device", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      status: true,
      info: [
        { device: "919999999999", status: "Connected" },
        { device: "918920847457", status: "Disconnected" },
      ],
    })));
    await expect(getDeviceStatus(config)).resolves.toMatchObject({ ok: true, device: { connected: false, status: "Disconnected" } });
  });

  it("classifies the production invalid-sender response as absent but not generic permission errors", () => {
    expect(isWhatsappDeviceNotFoundMessage("Invalid sender device. This device is not added under this API key.")).toBe(true);
    expect(isWhatsappDeviceNotFoundMessage("The number does not exist, or you do not have permission.")).toBe(false);
  });

  describe("device matching in getDeviceStatus", () => {
    const testConfig: WhatsappConfig = {
      apiKey: "tenant-key",
      baseUrl: "https://provider.test/api",
      sender: "919599143235",
    };

    it("matches device using 'body' property with 10-digit number", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [{ id: 1, body: "9599143235", status: "Connected" }],
      })));
      await expect(getDeviceStatus(testConfig)).resolves.toEqual({
        ok: true,
        device: {
          status: "Connected",
          connected: true,
          webhookUrl: null,
          messagesSent: null,
        },
      });
    });

    it("returns NOT_FOUND for a single row with a different number instead of falling back to row 0", async () => {
      const differentDeviceConfig: WhatsappConfig = {
        ...testConfig,
        sender: "919582609956",
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [{ id: 1, body: "919599143235", status: "Connected" }],
      })));
      await expect(getDeviceStatus(differentDeviceConfig)).resolves.toEqual({
        ok: false,
        reason: "NOT_FOUND",
        message: "Requested WhatsApp device was not found under this provider account.",
      });
    });

    it("correctly selects the matching row from multiple rows even if disconnected", async () => {
      const targetConfig: WhatsappConfig = {
        ...testConfig,
        sender: "919582609956",
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [
          { id: 1, body: "919599143235", status: "Connected" },
          { id: 2, body: "919582609956", status: "Disconnected" },
        ],
      })));
      await expect(getDeviceStatus(targetConfig)).resolves.toEqual({
        ok: true,
        device: {
          status: "Disconnected",
          connected: false,
          webhookUrl: null,
          messagesSent: null,
        },
      });
    });

    it("returns NOT_FOUND when no row matches across multiple rows", async () => {
      const targetConfig: WhatsappConfig = {
        ...testConfig,
        sender: "919582609956",
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [
          { id: 1, body: "919599143235", status: "Connected" },
          { id: 2, body: "918888888888", status: "Connected" },
        ],
      })));
      await expect(getDeviceStatus(targetConfig)).resolves.toEqual({
        ok: false,
        reason: "NOT_FOUND",
        message: "Requested WhatsApp device was not found under this provider account.",
      });
    });

    it.each([
      ["device", "919599143235"],
      ["sender", "919599143235"],
      ["number", "919599143235"],
      ["phone", "919599143235"],
      ["phone_number", "919599143235"],
      ["jid", "919599143235@s.whatsapp.net"],
      ["jid", "919599143235:1@s.whatsapp.net"],
    ])("matches requested device across legacy identity key '%s'", async (key, val) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [{ [key]: val, status: "Connected" }],
      })));
      await expect(getDeviceStatus(testConfig)).resolves.toEqual({
        ok: true,
        device: {
          status: "Connected",
          connected: true,
          webhookUrl: null,
          messagesSent: null,
        },
      });
    });

    it("normalizes formatting like '+91 95991 43235' to match '919599143235'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [{ body: "+91 95991 43235", status: "Connected" }],
      })));
      await expect(getDeviceStatus(testConfig)).resolves.toEqual({
        ok: true,
        device: {
          status: "Connected",
          connected: true,
          webhookUrl: null,
          messagesSent: null,
        },
      });
    });

    it("rejects similar numbers like '919599143236' with NOT_FOUND", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
        status: true,
        info: [{ body: "919599143236", status: "Connected" }],
      })));
      await expect(getDeviceStatus(testConfig)).resolves.toEqual({
        ok: false,
        reason: "NOT_FOUND",
        message: "Requested WhatsApp device was not found under this provider account.",
      });
    });
  });
});
