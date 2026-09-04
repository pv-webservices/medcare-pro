import { afterEach, describe, expect, it } from "vitest";
import {
  decryptWhatsappApiKey,
  encryptWhatsappApiKey,
  WhatsappCredentialKeyError,
} from "@/lib/whatsappCredentialCrypto";

const ENV_NAME = "WHATSAPP_PROVIDER_ENCRYPTION_KEY";
const original = process.env[ENV_NAME];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = original;
});

describe("WhatsApp credential encryption", () => {
  it("round-trips an API key without placing plaintext in the envelope", () => {
    process.env[ENV_NAME] = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptWhatsappApiKey("rkv-secret-value", "tenant-a", "account-a");

    expect(encrypted).not.toContain("rkv-secret-value");
    expect(decryptWhatsappApiKey(encrypted, "tenant-a", "account-a"))
      .toBe("rkv-secret-value");
  });

  it("binds ciphertext to both tenant and provider account", () => {
    process.env[ENV_NAME] = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptWhatsappApiKey("secret-value", "tenant-a", "account-a");

    expect(() => decryptWhatsappApiKey(encrypted, "tenant-b", "account-a"))
      .toThrow(WhatsappCredentialKeyError);
    expect(() => decryptWhatsappApiKey(encrypted, "tenant-a", "account-b"))
      .toThrow(WhatsappCredentialKeyError);
  });

  it("fails closed when the deployment key is absent or malformed", () => {
    delete process.env[ENV_NAME];
    expect(() => encryptWhatsappApiKey("secret-value", "tenant-a", "account-a"))
      .toThrow(WhatsappCredentialKeyError);

    process.env[ENV_NAME] = "too-short";
    expect(() => encryptWhatsappApiKey("secret-value", "tenant-a", "account-a"))
      .toThrow(WhatsappCredentialKeyError);
  });
});
