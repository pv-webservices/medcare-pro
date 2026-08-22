import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERIFICATION_PURPOSE,
  isVerificationPurpose,
  purposeMatches,
  VERIFICATION_PURPOSES,
} from "@/lib/verificationPurpose";

describe("isVerificationPurpose", () => {
  it("accepts the two known purposes", () => {
    expect(isVerificationPurpose("TENANT_EMAIL")).toBe(true);
    expect(isVerificationPurpose("USER_EMAIL")).toBe(true);
  });

  it("rejects anything else, including null and casing variants", () => {
    expect(isVerificationPurpose(null)).toBe(false);
    expect(isVerificationPurpose(undefined)).toBe(false);
    expect(isVerificationPurpose("")).toBe(false);
    expect(isVerificationPurpose("tenant_email")).toBe(false);
    expect(isVerificationPurpose("INVITE")).toBe(false);
  });
});

describe("purposeMatches", () => {
  it("matches a row to its own purpose", () => {
    expect(purposeMatches("TENANT_EMAIL", VERIFICATION_PURPOSES.TENANT_EMAIL)).toBe(
      true,
    );
    expect(purposeMatches("USER_EMAIL", VERIFICATION_PURPOSES.USER_EMAIL)).toBe(
      true,
    );
  });

  it("refuses to redeem one flow's token in the other", () => {
    // The reason the column exists: at signup both flows carry the SAME email.
    expect(purposeMatches("USER_EMAIL", VERIFICATION_PURPOSES.TENANT_EMAIL)).toBe(
      false,
    );
    expect(purposeMatches("TENANT_EMAIL", VERIFICATION_PURPOSES.USER_EMAIL)).toBe(
      false,
    );
  });

  it("treats a legacy row with no purpose as the tenant flow", () => {
    // Every token issued before the column existed came from signup.
    expect(purposeMatches(null, VERIFICATION_PURPOSES.TENANT_EMAIL)).toBe(true);
    expect(purposeMatches(undefined, VERIFICATION_PURPOSES.TENANT_EMAIL)).toBe(true);
    expect(purposeMatches(null, VERIFICATION_PURPOSES.USER_EMAIL)).toBe(false);
  });

  it("matches nothing when the stored value is unrecognised", () => {
    // A row whose meaning we cannot read must not be guessed at.
    expect(purposeMatches("SOMETHING_ELSE", VERIFICATION_PURPOSES.TENANT_EMAIL)).toBe(
      false,
    );
    expect(purposeMatches("SOMETHING_ELSE", VERIFICATION_PURPOSES.USER_EMAIL)).toBe(
      false,
    );
  });

  it("pins the column default to the tenant flow", () => {
    expect(DEFAULT_VERIFICATION_PURPOSE).toBe(VERIFICATION_PURPOSES.TENANT_EMAIL);
  });
});
