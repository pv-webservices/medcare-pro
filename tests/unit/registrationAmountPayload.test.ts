import { describe, expect, it } from "vitest";
import { registrationAmountPayload } from "@/lib/registrationAmountPayload";

describe("registration form amount payload", () => {
  it("omits unchanged amounts only in edit mode", () => {
    expect(registrationAmountPayload(true, "200.00", "200.00")).toEqual({});
    expect(registrationAmountPayload(true, "200", "200.00")).toEqual({});
    expect(registrationAmountPayload(true, "201.00", "200.00")).toEqual({ amount: 201 });
    expect(registrationAmountPayload(false, "200.00", "200.00")).toEqual({ amount: 200 });
    expect(registrationAmountPayload(false, "0.00")).toEqual({ amount: 0 });
  });
});
