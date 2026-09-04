import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENV_NAME = "WHATSAPP_PROVIDER_ENCRYPTION_KEY";
const VERSION = "v1";

export class WhatsappCredentialKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappCredentialKeyError";
  }
}

function readMasterKey(): Buffer {
  const raw = (process.env[ENV_NAME] ?? "").trim();
  if (!raw) {
    throw new WhatsappCredentialKeyError(
      `${ENV_NAME} is required to store or use tenant WhatsApp credentials.`,
    );
  }

  let decoded: Buffer;
  if (/^[a-f\d]{64}$/i.test(raw)) {
    decoded = Buffer.from(raw, "hex");
  } else {
    decoded = Buffer.from(raw, "base64");
  }

  if (decoded.length !== 32) {
    throw new WhatsappCredentialKeyError(
      `${ENV_NAME} must decode to exactly 32 bytes.`,
    );
  }
  return decoded;
}

function aad(tenantId: string, accountId: string): Buffer {
  return createHash("sha256")
    .update(`medcare-pro:whatsapp:${tenantId}:${accountId}`)
    .digest();
}

/** AES-256-GCM envelope. The deployment key never enters the database. */
export function encryptWhatsappApiKey(
  plaintext: string,
  tenantId: string,
  accountId: string,
): string {
  const value = plaintext.trim();
  if (!value) {
    throw new WhatsappCredentialKeyError("The RkvRobo API key cannot be empty.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readMasterKey(), iv);
  cipher.setAAD(aad(tenantId, accountId));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptWhatsappApiKey(
  envelope: string,
  tenantId: string,
  accountId: string,
): string {
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra) {
    throw new WhatsappCredentialKeyError("Stored WhatsApp credential is invalid.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      readMasterKey(),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAAD(aad(tenantId, accountId));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error: unknown) {
    if (error instanceof WhatsappCredentialKeyError) throw error;
    throw new WhatsappCredentialKeyError(
      "Stored WhatsApp credential could not be decrypted.",
    );
  }
}
