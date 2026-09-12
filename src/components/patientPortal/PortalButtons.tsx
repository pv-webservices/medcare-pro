"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function PortalLogout() {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          const r = await fetch("/api/patient-portal/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (r.ok) {
            router.replace("/patient/login");
            router.refresh();
          } else setError("Could not sign out. Please try again.");
        }}
      >
        Logout
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function PortalPrint() {
  return (
    <button
      className="portal-primary portal-no-print"
      onClick={() => window.print()}
    >
      Print / Save as PDF
    </button>
  );
}
