import { describe, expect, it } from "vitest";
import { buildMainMenuPrompt } from "@/lib/telephony/ivr";
import {
  MAIN_MENU_ROUTES,
  resolveMainMenuAction,
} from "@/lib/telephony/routing";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const INPUT_WEBHOOK_URL =
  "https://medcare-tunnel.example/api/webhooks/plivo/input";

describe("unexposed Plivo IVR design", () => {
  it("builds the intended deterministic clinic menu", () => {
    expect(buildMainMenuPrompt("  MedCare   Clinic  ")).toBe(
      "Welcome to MedCare Clinic. Press 1 for tomorrow slots. " +
        "Press 2 for appointment booking. Press 3 for urgent assistance. " +
        "Press 4 for clinic information. Press 9 to repeat these options.",
    );
  });

  it("requires a clinic name", () => {
    expect(() => buildMainMenuPrompt("   ")).toThrow(
      "A clinic name is required",
    );
  });

  it.each([
    ["1", "tomorrow-slots"],
    ["2", "appointment-booking"],
    ["3", "urgent-assistance"],
    ["4", "clinic-information"],
    ["9", "repeat-menu"],
  ] as const)("routes digit %s to %s", (digits, expectedAction) => {
    expect(resolveMainMenuAction(digits)).toBe(expectedAction);
  });

  it.each([undefined, null, "", "0", "5", "12", "invalid"])(
    "routes unsupported input %s to invalid-input",
    (digits) => {
      expect(resolveMainMenuAction(digits)).toBe("invalid-input");
    },
  );

  it("keeps the five intended digits as the complete menu surface", () => {
    expect(Object.keys(MAIN_MENU_ROUTES)).toEqual(["1", "2", "3", "4", "9"]);
  });

  it.each(["1", "2", "3", "4", "9"] as const)(
    "represents keypad digit %s in a legitimately signed callback",
    async (digits) => {
      const request = buildSignedPlivoWebhookRequest({
        url: INPUT_WEBHOOK_URL,
        paramOverrides: { Digits: digits },
      });
      const verification = await verifyPlivoV3Webhook(
        request,
        TEST_PLIVO_AUTH_TOKEN,
      );

      expect(verification.ok).toBe(true);
      if (!verification.ok) {
        throw new Error("The signed Plivo test callback was not validated.");
      }

      expect(Object.isFrozen(verification.params)).toBe(true);
      expect(verification.params.Digits).toBe(digits);
      expect(resolveMainMenuAction(verification.params.Digits.toString())).toBe(
        MAIN_MENU_ROUTES[digits].action,
      );
    },
  );
});
