import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  resolve("src/components/dashboard/BookingFollowUpsPanel.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  resolve("src/components/dashboard/AdminDashboard.tsx"),
  "utf8",
);
const phoneSettings = readFileSync(
  resolve("src/components/settings/PhoneSettingsEditor.tsx"),
  "utf8",
);

describe("booking follow-up and caller-number UI", () => {
  it("uses the existing clinics [id] segment so the production router can start", () => {
    expect(
      existsSync(
        resolve(
          "src/app/api/clinics/[id]/telephony/booking-follow-ups/[requestId]/resolve/route.ts",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          "src/app/api/clinics/[clinicId]/telephony/booking-follow-ups/[requestId]/resolve/route.ts",
        ),
      ),
    ).toBe(false);
  });

  it("renders the operational panel beside call handling, outside layout widgets", () => {
    expect(component).toContain("Booking follow-ups");
    expect(component).toContain("Pending IVR requests that need staff action");
    expect(dashboard.indexOf("<BookingFollowUpsPanel")).toBeGreaterThan(
      dashboard.indexOf("<CallHandlingPanel"),
    );
    expect(dashboard.indexOf("<DashboardLayoutEditor")).toBeGreaterThan(
      dashboard.indexOf("<BookingFollowUpsPanel"),
    );
  });

  it("shows safe call and resolution actions without patient wording", () => {
    expect(component).toContain("href={`tel:${item.callerNumber}`}");
    expect(component).toContain("Mark resolved");
    expect(component).not.toMatch(/patientName|patient candidate/i);
  });

  it("makes new diagnostic caller numbers callable while preserving labels", () => {
    expect(phoneSettings).toContain("href={`tel:${call.callerNumber}`}");
    expect(phoneSettings).toContain("{call.callerLabel}");
  });
});
