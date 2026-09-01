import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shellSource = readFileSync(
  resolve("src/components/owner/OwnerShell.tsx"),
  "utf8",
);
const dashboardPageSource = readFileSync(
  resolve("src/app/owner/dashboard/page.tsx"),
  "utf8",
);

describe("Superadmin Owner Dashboard Layout & Top Bar", () => {
  it("removes calendar and message quick action icons from the top bar", () => {
    // Header right-side should only have notification bell and OwnerUserMenu
    expect(shellSource).not.toContain("Calendar overview");
    expect(shellSource).not.toContain("Activity messages");
    expect(shellSource).toContain('aria-label="Applications notifications"');
    expect(shellSource).toContain("<OwnerUserMenu");
  });

  it("does not import unused Calendar and MessageSquare in OwnerShell", () => {
    expect(shellSource).not.toMatch(/import\s*{[^}]*\bCalendar\b[^}]*}\s*from\s*"lucide-react"/);
    expect(shellSource).not.toMatch(/import\s*{[^}]*\bMessageSquare\b[^}]*}\s*from\s*"lucide-react"/);
  });

  it("uses fluid responsive width with consistent desktop gutters on the dashboard", () => {
    expect(dashboardPageSource).toContain("w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6");
    expect(dashboardPageSource).not.toContain("max-w-7xl");
  });

  it("applies consistent 20px (gap-5) card grid spacing across all sections", () => {
    // KPI cards grid
    expect(dashboardPageSource).toContain("grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4");
    // Management navigation cards grid
    expect(dashboardPageSource).toContain("grid grid-cols-1 gap-5 md:grid-cols-3");
    // Lower analytics section grid
    expect(dashboardPageSource).toContain("grid grid-cols-1 gap-5 lg:grid-cols-12");
  });

  it("preserves sidebar width and responsive drawer functionality", () => {
    expect(shellSource).toContain("w-64 shrink-0");
    expect(shellSource).toContain("isMobileMenuOpen");
  });
});
