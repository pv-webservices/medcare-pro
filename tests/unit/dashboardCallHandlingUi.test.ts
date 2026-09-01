import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGET_LIST } from "@/lib/dashboardWidgets";
import {
  callHandlingMutationReducer,
  type CallHandlingMutationState,
} from "@/components/dashboard/CallHandlingPanel";
import { DASHBOARD_CALL_HANDLING_OPTIONS } from "@/lib/telephony/dashboardCallHandlingState";

const componentSource = readFileSync(
  resolve("src/components/dashboard/CallHandlingPanel.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve("src/components/dashboard/AdminDashboard.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  resolve("src/app/(dashboard)/dashboard/page.tsx"),
  "utf8",
);

describe("dashboard call-handling UI contract", () => {
  it("maps product labels to the existing backend enum", () => {
    expect(DASHBOARD_CALL_HANDLING_OPTIONS).toEqual([
      { label: "Auto", routingMode: "AUTO" },
      { label: "Reception", routingMode: "OPEN" },
      { label: "IVR", routingMode: "AFTER_HOURS" },
    ]);
  });

  it("marks a choice pending and commits only after success", () => {
    const initial: CallHandlingMutationState = {
      confirmedMode: "AUTO",
      pendingMode: null,
    };
    const pending = callHandlingMutationReducer(initial, {
      type: "begin",
      routingMode: "OPEN",
    });
    expect(pending).toEqual({ confirmedMode: "AUTO", pendingMode: "OPEN" });
    expect(
      callHandlingMutationReducer(pending, {
        type: "success",
        routingMode: "OPEN",
      }),
    ).toEqual({ confirmedMode: "OPEN", pendingMode: null });
  });

  it("rolls a failed choice back and re-enables the confirmed choice", () => {
    const failed = callHandlingMutationReducer(
      { confirmedMode: "AUTO", pendingMode: "AFTER_HOURS" },
      { type: "failure" },
    );
    expect(failed).toEqual({ confirmedMode: "AUTO", pendingMode: null });
  });

  it("resets state when server clinic state is replaced", () => {
    expect(
      callHandlingMutationReducer(
        { confirmedMode: "OPEN", pendingMode: "AUTO" },
        { type: "reset", routingMode: "AFTER_HOURS" },
      ),
    ).toEqual({ confirmedMode: "AFTER_HOURS", pendingMode: null });
  });

  it("uses an accessible radio-group control with pending and disabled state", () => {
    expect(componentSource).toContain('role="radiogroup"');
    expect(componentSource).toContain('role="radio"');
    expect(componentSource).toContain("aria-checked={selected}");
    expect(componentSource).toContain("aria-busy={mutation.pendingMode !== null}");
    expect(componentSource).toContain("tabIndex={selected ? 0 : -1}");
    expect(componentSource).toContain("ArrowRight");
    expect(componentSource).toContain(
      "disabled={!model.enabled || mutation.pendingMode !== null}",
    );
    expect(componentSource).toContain("min-h-11");
  });

  it("PATCHes only routingMode and keeps 403 as a visible failure", () => {
    expect(componentSource).toContain("body: JSON.stringify({ routingMode })");
    expect(componentSource).toContain("response.status === 403");
    expect(componentSource).toContain(
      "You don't have permission to change call handling.",
    );
  });

  it("does not expose infrastructure fields in the dashboard component", () => {
    expect(componentSource).not.toContain("plivoNumber");
    expect(componentSource).not.toContain("publicPhoneNumber");
    expect(componentSource).not.toContain("receptionPhoneNumber");
    expect(componentSource).not.toContain("urgentPhoneNumber");
    expect(componentSource).not.toContain("PLIVO_PUBLIC_WEBHOOK_ORIGIN");
  });

  it("renders All clinics as a non-mutating per-clinic explanation", () => {
    expect(componentSource).toContain(
      "Call routing is configured per clinic. Select a clinic above to view or change its routing.",
    );
    expect(componentSource).toContain(
      "No routing changes are available in the All clinics view.",
    );
    expect(pageSource).toContain("selectedClinicId === null");
    expect(pageSource).toContain("Promise.resolve(null)");
  });

  it("keeps Call Handling fixed before and outside DashboardLayoutEditor", () => {
    expect(dashboardSource.indexOf("<CallHandlingPanel")).toBeGreaterThan(-1);
    expect(dashboardSource.indexOf("<DashboardLayoutEditor")).toBeGreaterThan(
      dashboardSource.indexOf("<CallHandlingPanel"),
    );
    expect(
      DASHBOARD_WIDGET_LIST.some((widget) =>
        widget.id.toLowerCase().includes("call"),
      ),
    ).toBe(false);
  });

  it("keys the panel by resolved clinic and never reads the cookie in the page", () => {
    expect(dashboardSource).toContain(
      'key={callHandling?.clinicId ?? "all-clinics"}',
    );
    expect(pageSource).toContain("resolveSelectedClinicId(actor)");
    expect(pageSource).not.toContain("cookies(");
  });
});
