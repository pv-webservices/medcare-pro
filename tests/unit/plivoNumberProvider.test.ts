import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLIVO_NUMBER_QUARANTINE_DAYS,
  isPlatformPlivoInventoryAuthoritative,
  resolvePlatformPlivoEnvironment,
  resolvePlivoNumberQuarantineDays,
} from "@/lib/platform/plivoNumberEnvironment";
import { extractPlivoApplicationId } from "@/lib/platform/plivoNumberProvider";

describe("Plivo number provider configuration", () => {
  it("extracts an application id from provider resource URIs", () => {
    expect(extractPlivoApplicationId("/v1/Account/MA123/Application/31757617137466453/")).toBe("31757617137466453");
    expect(extractPlivoApplicationId("31757617137466453")).toBe("31757617137466453");
    expect(extractPlivoApplicationId(null)).toBeNull();
  });

  it("fails closed when credentials or expected application are absent", () => {
    expect(resolvePlatformPlivoEnvironment({ PLIVO_AUTH_ID: "id", PLIVO_AUTH_TOKEN: "token" })).toBeNull();
    expect(resolvePlatformPlivoEnvironment({ PLIVO_AUTH_ID: "id", PLIVO_AUTH_TOKEN: "token", PLIVO_IVR_APPLICATION_ID: "31757617137466453" })).toMatchObject({ expectedApplicationId: "31757617137466453", quarantineDays: 14 });
  });

  it("bounds quarantine configuration and requires an exact authority opt-in", () => {
    expect(resolvePlivoNumberQuarantineDays({ PLIVO_NUMBER_QUARANTINE_DAYS: "30" })).toBe(30);
    expect(resolvePlivoNumberQuarantineDays({ PLIVO_NUMBER_QUARANTINE_DAYS: "0" })).toBe(DEFAULT_PLIVO_NUMBER_QUARANTINE_DAYS);
    expect(isPlatformPlivoInventoryAuthoritative({ PLIVO_NUMBER_INVENTORY_AUTHORITY_ENABLED: "true" })).toBe(true);
    expect(isPlatformPlivoInventoryAuthoritative({ PLIVO_NUMBER_INVENTORY_AUTHORITY_ENABLED: "TRUE" })).toBe(false);
  });
});
