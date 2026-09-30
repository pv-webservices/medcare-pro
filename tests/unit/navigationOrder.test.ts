import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import DashboardNav from "@/components/dashboard/DashboardNav";
import { NAV_LINKS, visibleNavLinks } from "@/lib/navigation";

describe("sidebar order", () => {
  it("puts Billing directly after Registrations, with Dashboard ahead of both", () => {
    const labels = NAV_LINKS.map((link) => link.label);
    expect(labels.indexOf("Billing")).toBe(labels.indexOf("Registrations") + 1);
    expect(labels.indexOf("Dashboard")).toBeLessThan(labels.indexOf("Billing"));
  });

  it("renders Billing right after Registrations in the sidebar itself", () => {
    const html = renderToStaticMarkup(createElement(DashboardNav, { links: visibleNavLinks(() => true, () => true), unreadNotifications: 0 }));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.indexOf("/billing")).toBe(hrefs.indexOf("/registration") + 1);
    expect(hrefs.indexOf("/dashboard")).toBe(0);
  });

  it("keeps Billing's gating unchanged", () => {
    expect(NAV_LINKS.find((link) => link.href === "/billing")).toEqual({ href: "/billing", label: "Billing", permission: "invoice:read", feature: "billing" });
  });
});
