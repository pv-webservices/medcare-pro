import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDeviceQr, getDeviceStatus, type WhatsappConfig } from "@/lib/whatsapp";

const config: WhatsappConfig = {
  apiKey: "tenant-key",
  baseUrl: "https://provider.test/api",
  sender: "918920847457",
};

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
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
  ])("accepts usable QR material despite unusual generate-qr status: $status", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(generateDeviceQr(config, config.sender)).resolves.toMatchObject({
      ok: true,
      qr: expect.any(String),
    });
  });

  it("classifies an explicit provider rejection as definitive", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      { status: false, msg: "Invalid device" },
      { ok: false, status: 400 },
    )));
    await expect(generateDeviceQr(config, config.sender)).resolves.toEqual({
      ok: false,
      definitive: true,
      message: "Invalid device",
    });
  });

  it("classifies an unreadable successful response as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("not-json-object")));
    await expect(generateDeviceQr(config, config.sender)).resolves.toMatchObject({
      ok: false,
      definitive: false,
    });
  });

  it("selects the requested device rather than another account device", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      status: true,
      info: [
        { device: "919999999999", status: "Connected" },
        { device: "918920847457", status: "Disconnected" },
      ],
    })));
    await expect(getDeviceStatus(config)).resolves.toMatchObject({
      ok: true,
      device: { connected: false, status: "Disconnected" },
    });
  });
});
