import { describe, expect, it } from "vitest";
import { percentChange } from "@/lib/dashboardDateRange";

describe("dashboard percentage changes", () => {
  it("returns a finite percentage for a meaningful comparison", () => {
    expect(percentChange(125, 100)).toBe(25);
    expect(percentChange(75, 100)).toBe(-25);
  });

  it("returns zero when both periods are empty", () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it("does not invent an infinite increase from no baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});
