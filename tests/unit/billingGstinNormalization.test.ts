import { describe, expect, it } from "vitest";
import { billingSettingsSchema } from "@/lib/billing/billingValidation";

describe("billing GSTIN normalization", () => {
  it("uppercases and trims before validating the checksum", () => {
    expect(billingSettingsSchema.parse({ gstin: " 27aapfu0939f1zv " }).gstin).toBe("27AAPFU0939F1ZV");
  });
  it("still rejects invalid checksums", () => {
    expect(billingSettingsSchema.safeParse({ gstin: "27aapfu0939f1z0" }).success).toBe(false);
  });
});
