import type { ReactNode } from "react";
import Link from "next/link";
import { patientPortalPage } from "@/lib/patientPortalPages";
import { PortalLogout } from "@/components/patientPortal/PortalButtons";
export default async function Layout({ children }: { children: ReactNode }) {
  await patientPortalPage(async () => null);
  return (
    <>
      <header className="portal-header portal-no-print">
        <Link className="portal-brand" href="/patient">
          MEDCARE <strong>PRO</strong>
          <span>Patient Portal</span>
        </Link>
        <nav aria-label="Patient navigation">
          {[
            ["", "Home"],
            ["visits", "My Visits"],
            ["prescriptions", "My Prescriptions"],
            ["appointments", "Appointments"],
            ["profile", "My Profile"],
          ].map(([path, label]) => (
            <Link key={path} href={`/patient${path ? `/${path}` : ""}`}>
              {label}
            </Link>
          ))}
          <PortalLogout />
        </nav>
      </header>
      <main className="portal-main">{children}</main>
      <footer className="portal-footer portal-no-print">
        Your personal records. Securely linked by your clinic.
      </footer>
    </>
  );
}
