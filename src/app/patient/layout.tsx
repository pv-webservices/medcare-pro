import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./portal.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Patient Portal · MEDCARE PRO",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function PatientLayout({ children }: { children: ReactNode }) {
  return <div className="patient-portal">{children}</div>;
}
