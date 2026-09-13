import Link from "next/link";
import { patientPortalPage } from "@/lib/patientPortalPages";
import {
  patientPortalProfile,
  patientPortalHistory,
} from "@/lib/patientPortalRecords";
export default async function Page() {
  const data = await patientPortalPage(async (actor) => ({
    profile: await patientPortalProfile(actor),
    visits: await patientPortalHistory(actor, "visits"),
    prescriptions: await patientPortalHistory(actor, "prescriptions"),
  }));
  return (
    <>
      <p className="portal-eyebrow">YOUR PERSONAL CARE RECORD</p>
      <h1>Welcome, {data.profile.name}</h1>
      <p className="portal-muted">
        Visits, prescriptions and personal information, securely in one place.
      </p>
      <div className="portal-home-grid">
        {[
          ["visits", "Recent visits", data.visits],
          ["prescriptions", "Recent prescriptions", data.prescriptions],
        ].map(([kind, title, history]) => {
          const h = history as typeof data.visits;
          return (
            <section className="portal-panel" key={kind as string}>
              <h2>{title as string}</h2>
              {h.items.length ? (
                h.items.slice(0, 3).map((item) => (
                  <div className="portal-record" key={item.id}>
                    <p>{item.type}</p>
                    <p>
                      {item.doctor} · {item.date.slice(0, 10)}
                    </p>
                  </div>
                ))
              ) : (
                <p>No {kind as string} available yet.</p>
              )}
              <Link href={`/patient/${kind as string}`}>View all →</Link>
            </section>
          );
        })}
      </div>
      <Link className="portal-shortcut" href="/patient/appointments">
        My appointments →
      </Link>
      <Link className="portal-shortcut" href="/patient/profile">
        My profile →
      </Link>
    </>
  );
}
