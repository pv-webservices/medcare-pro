import { describe, expect, it } from "vitest";
import {
  computeFloatingPosition,
  resolveFloatingPanelWidth,
} from "@/components/ui/useFloatingPopover";

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

describe("computeFloatingPosition", () => {
  function createMockTrigger(rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  }) {
    return {
      getBoundingClientRect: () => rect,
    };
  }

  it("anchors directly below trigger with start alignment and top-left transform origin", () => {
    const trigger = createMockTrigger({
      top: 100,
      bottom: 144,
      left: 200,
      right: 360,
      width: 160,
      height: 44,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "start",
      offset: 6,
      defaultWidth: 240,
      defaultHeight: 200,
    });

    expect(pos).not.toBeNull();
    expect(pos?.top).toBe(150); // 144 + 6
    expect(pos?.left).toBe(200); // trigger.left
    expect(pos?.openUpward).toBe(false);
    expect(pos?.transformOrigin).toBe("top left");
  });

  it("anchors directly below trigger with end alignment and top-right transform origin", () => {
    const trigger = createMockTrigger({
      top: 100,
      bottom: 144,
      left: 200,
      right: 360,
      width: 160,
      height: 44,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "end",
      offset: 6,
      defaultWidth: 240,
      defaultHeight: 200,
    });

    expect(pos).not.toBeNull();
    expect(pos?.top).toBe(150); // 144 + 6
    expect(pos?.left).toBe(120); // 360 - 240
    expect(pos?.openUpward).toBe(false);
    expect(pos?.transformOrigin).toBe("top right");
  });

  it("flips upward when viewport bottom collides and sets bottom transform origin", () => {
    // Place trigger near the bottom of a 768px viewport
    const trigger = createMockTrigger({
      top: 680,
      bottom: 724,
      left: 200,
      right: 360,
      width: 160,
      height: 44,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "start",
      offset: 6,
      defaultWidth: 240,
      defaultHeight: 200,
    });

    expect(pos).not.toBeNull();
    expect(pos?.openUpward).toBe(true);
    expect(pos?.top).toBe(474); // 680 - 6 - 200
    expect(pos?.left).toBe(200);
    expect(pos?.transformOrigin).toBe("bottom left");
  });

  it("clamps left position to avoid left viewport overflow (< 8px)", () => {
    const trigger = createMockTrigger({
      top: 100,
      bottom: 144,
      left: 2,
      right: 162,
      width: 160,
      height: 44,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "start",
      offset: 6,
      defaultWidth: 240,
      defaultHeight: 200,
    });

    expect(pos).not.toBeNull();
    expect(pos?.left).toBe(8);
  });

  it("matches trigger width when matchTriggerWidth is true", () => {
    const trigger = createMockTrigger({
      top: 100,
      bottom: 144,
      left: 200,
      right: 480,
      width: 280,
      height: 44,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "start",
      matchTriggerWidth: true,
      defaultHeight: 200,
    });

    expect(pos).not.toBeNull();
    expect(pos?.width).toBe(280);
  });

  it("returns null when trigger has zero dimensions (unmounted/hidden)", () => {
    const trigger = createMockTrigger({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    });

    const pos = computeFloatingPosition({
      triggerEl: trigger,
      align: "start",
    });

    expect(pos).toBeNull();
  });
});

