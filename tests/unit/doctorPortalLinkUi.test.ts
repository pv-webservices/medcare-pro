import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import DoctorForm from "@/components/doctors/DoctorForm";

const clinics = [{ id: "clinic-a", name: "Clinic A" }];
const portalUsers = [
  {
    id: "portal-user",
    name: "Dr. Portal",
    email: "portal@example.com",
    linkedClinicIds: [],
  },
];

describe("Add Doctor portal-link control", () => {
  it("omits the selector and candidate data for a create-only actor", () => {
    const html = renderToStaticMarkup(
      createElement(DoctorForm, { clinics, portalUsers }),
    );

    expect(html).not.toContain("Linked portal user");
    expect(html).not.toContain("portal@example.com");
  });

  it("shows the optional selector for a clinic where the actor can edit Doctors", () => {
    const html = renderToStaticMarkup(
      createElement(DoctorForm, {
        clinics,
        portalUsers,
        portalLinkClinicIds: ["clinic-a"],
      }),
    );

    expect(html).toContain("Linked portal user (optional)");
    expect(html).toContain("portal@example.com");
  });
});
