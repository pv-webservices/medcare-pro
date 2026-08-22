import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  normalizeSignupInput,
  signupSchema,
} from "@/lib/signupInput";

const VALID = {
  name: "Dr Amelia Rao",
  email: "Amelia@Example.COM",
  clinicName: "Dental Care Clinic",
  city: "Pune",
  phone: "+91 98765 43210",
  address: "Shop 4, MG Road",
  businessEmail: "Accounts@Example.com",
  password: "a-long-enough-password",
  acceptTerms: true,
} as const;

function parse(overrides: Record<string, unknown> = {}) {
  return signupSchema.safeParse({ ...VALID, ...overrides });
}

describe("signupSchema", () => {
  it("accepts a complete registration", () => {
    expect(parse().success).toBe(true);
  });

  it("requires the consent to be ticked", () => {
    const result = parse({ acceptTerms: false });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/terms/i);
  });

  it("requires each of the mandatory fields", () => {
    for (const field of ["name", "clinicName", "city", "phone"] as const) {
      expect(parse({ [field]: "" }).success).toBe(false);
      expect(parse({ [field]: "   " }).success).toBe(false);
    }
  });

  it("keeps the existing password policy", () => {
    expect(parse({ password: "x".repeat(MIN_PASSWORD_LENGTH - 1) }).success).toBe(
      false,
    );
    expect(parse({ password: "x".repeat(MIN_PASSWORD_LENGTH) }).success).toBe(true);
  });

  it("treats address and business email as optional", () => {
    expect(parse({ address: undefined, businessEmail: undefined }).success).toBe(
      true,
    );
    // The empty string is what an untouched input posts — it means "not given".
    expect(parse({ address: "", businessEmail: "" }).success).toBe(true);
  });

  it("rejects a phone number that is not one", () => {
    expect(parse({ phone: "call me" }).success).toBe(false);
    expect(parse({ phone: "12345" }).success).toBe(false);
    expect(parse({ phone: "1".repeat(16) }).success).toBe(false);
  });

  it("accepts the punctuation people actually type", () => {
    for (const phone of ["+91 98765 43210", "(020) 2567-1234", "98765.43210"]) {
      expect(parse({ phone }).success).toBe(true);
    }
  });
});

describe("normalizeSignupInput", () => {
  function normalize(overrides: Record<string, unknown> = {}) {
    const parsed = signupSchema.parse({ ...VALID, ...overrides });
    return normalizeSignupInput(parsed);
  }

  it("lowercases both addresses", () => {
    const result = normalize();
    expect(result.email).toBe("amelia@example.com");
    expect(result.businessEmail).toBe("accounts@example.com");
  });

  it("turns blank optional fields into null, not empty strings", () => {
    const result = normalize({ address: "  ", businessEmail: "" });
    expect(result.address).toBeNull();
    expect(result.businessEmail).toBeNull();
  });

  it("trims the required fields", () => {
    const result = normalize({ name: "  Amelia  ", clinicName: " Clinic " });
    expect(result.name).toBe("Amelia");
    expect(result.clinicName).toBe("Clinic");
  });

  it("rejects a business email that is not an address", () => {
    expect(() => normalize({ businessEmail: "not-an-address" })).toThrow();
  });

  it("never rewrites the password", () => {
    expect(normalize({ password: "  spaced  out  " }).password).toBe(
      "  spaced  out  ",
    );
  });
});
