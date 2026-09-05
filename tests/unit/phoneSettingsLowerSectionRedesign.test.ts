import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const componentSource = readFileSync(
  resolve("src/components/settings/PhoneSettingsEditor.tsx"),
  "utf8",
);

describe("Phone settings lower section redesign", () => {
  it("renders a 2-column balanced desktop layout for Call destinations (5 cols) and Business hours (7 cols)", () => {
    expect(componentSource).toContain("grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start");
    expect(componentSource).toContain("lg:col-span-5");
    expect(componentSource).toContain("lg:col-span-7");
  });

  it("renders Call destinations card with 4 fields, icons, and save button", () => {
    expect(componentSource).toContain("Call destinations");
    expect(componentSource).toContain("Clinic public phone");
    expect(componentSource).toContain("Reception phone");
    expect(componentSource).toContain("Urgent phone");
    expect(componentSource).toContain("Timezone");
    expect(componentSource).toContain("Save call settings");
  });

  it("renders visual Routing summary flow diagram inside Call destinations", () => {
    expect(componentSource).toContain("Routing summary");
    expect(componentSource).toContain("Caller dials clinic number");
    expect(componentSource).toContain("IVR / Phone menu");
    expect(componentSource).toContain("Business hours or selection");
    expect(componentSource).toContain("Routed to target number");
  });

  it("renders Business hours schedule table with Day, Status, Open time, and Close time columns", () => {
    expect(componentSource).toContain("Business hours");
    expect(componentSource).toContain("Copy Monday to weekdays");
    expect(componentSource).toContain("Day");
    expect(componentSource).toContain("Status");
    expect(componentSource).toContain("Open time");
    expect(componentSource).toContain("Close time");
    expect(componentSource).toContain("Save business hours");
  });

  it("keeps Related controls and links to the dedicated IVR workspace", () => {
    expect(componentSource).toContain("Related controls");
    expect(componentSource).toContain("Configure phone menu");
    expect(componentSource).toContain("Edit IVR prompts, options, and destination mapping.");
    expect(componentSource).toContain("Open IVR workspace");
    expect(componentSource).toContain("Monitor calls, readiness, follow-ups and diagnostics.");
    expect(componentSource).toContain("Controlled menu tests use only the deployment-approved QA number");
  });

  it("ends after configuration and Related controls without operational sections", () => {
    const callDestinationsIndex = componentSource.indexOf("Call destinations");
    const businessHoursIndex = componentSource.indexOf("Business hours");
    const relatedControlsIndex = componentSource.indexOf("Related controls");
    expect(callDestinationsIndex).toBeLessThan(relatedControlsIndex);
    expect(businessHoursIndex).toBeLessThan(relatedControlsIndex);
    expect(componentSource).not.toContain("<ReadinessOverview");
    expect(componentSource).not.toContain('title="Test phone menu"');
    expect(componentSource).not.toContain("<PhoneDiagnosticsPanel");
  });
});
