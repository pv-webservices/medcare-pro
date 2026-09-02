import { describe, expect, it } from "vitest";
import {
  isCallTransferDestinationAvailable,
  resolveCallTransferDestinationSafety,
} from "@/lib/telephony/destinationSafety";

const SAFE = {
  providerNumber: "+919000000001",
  publicPhoneNumber: "+919000000002",
  destinationPhoneNumber: "+919000000003",
};

describe("canonical telephone transfer destination safety", () => {
  it("accepts a distinct canonical Indian destination", () => {
    expect(isCallTransferDestinationAvailable(SAFE)).toBe(true);
  });

  it.each([
    ["provider unavailable", { ...SAFE, providerNumber: null }, "provider-unavailable"],
    ["destination missing", { ...SAFE, destinationPhoneNumber: null }, "destination-unavailable"],
    ["non-Indian destination", { ...SAFE, destinationPhoneNumber: "+14155550100" }, "destination-unavailable"],
    ["provider loop", { ...SAFE, destinationPhoneNumber: SAFE.providerNumber }, "provider-loop"],
    ["public loop", { ...SAFE, destinationPhoneNumber: SAFE.publicPhoneNumber }, "public-number-loop"],
  ] as const)("rejects %s", (_case, input, issue) => {
    expect(resolveCallTransferDestinationSafety(input)).toEqual({
      available: false,
      issue,
    });
  });
});

