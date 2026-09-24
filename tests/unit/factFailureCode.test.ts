import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/errors";
import { factFailureCode } from "@/lib/clinical-facts/failure";

describe("fact extraction failure classification", () => {
  it("keeps run failures and known AI provider codes", () => {
    expect(factFailureCode(Object.assign(new Error("STALE"), { name: "FactRunFailure", failure: "STALE" }))).toBe("STALE");
    expect(factFailureCode(new AiError("TIMEOUT"))).toBe("TIMEOUT");
    // Duck-typed: the same class loaded twice (bundler/test runner) still counts.
    expect(factFailureCode(Object.assign(new Error("x"), { name: "AiError", code: "QUOTA" }))).toBe("QUOTA");
  });

  it.each([
    ["Prisma connection error", Object.assign(new Error("Can't reach database server at host"), { code: "P1001" })],
    ["Node socket error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["AiError name with a foreign code", Object.assign(new Error("x"), { name: "AiError", code: "P2002" })],
    ["run failure with an unbounded value", Object.assign(new Error("x"), { name: "FactRunFailure", failure: "Patient Asha: private text" })],
    ["plain error", new Error("Patient Asha: private text")],
    ["non-error value", "boom"],
  ])("does not misclassify a %s", (_label, error) => {
    expect(factFailureCode(error)).toBe("FAILED");
  });
});
