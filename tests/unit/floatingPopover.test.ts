import { describe, expect, it } from "vitest";
import { resolveFloatingPanelWidth } from "@/components/ui/useFloatingPopover";

describe("resolveFloatingPanelWidth", () => {
  it("uses the trigger width for select panels before their first visible frame", () => {
    expect(
      resolveFloatingPanelWidth({
        triggerWidth: 176,
        measuredPanelWidth: 465,
        matchTriggerWidth: true,
      }),
    ).toBe(176);
  });

  it("keeps measured sizing for floating panels that do not match their trigger", () => {
    expect(
      resolveFloatingPanelWidth({
        triggerWidth: 40,
        measuredPanelWidth: 240,
      }),
    ).toBe(240);
  });
});
