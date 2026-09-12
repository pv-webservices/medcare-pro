import Link from "next/link";
import { patientPortalPage } from "@/lib/patientPortalPages";
import { patientPortalHistory } from "@/lib/patientPortalRecords";
import { portalPageSchema } from "@/lib/patientPortalSecurity";
export default async function PortalHistoryPage({
  kind,
  searchParams,
}: {
  kind: "visits" | "appointments" | "prescriptions";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parsed = portalPageSchema.safeParse(raw);
  const page = parsed.success ? parsed.data.page : 1;
  const history = await patientPortalPage((actor) =>
    patientPortalHistory(actor, kind, page),
  );
  return (
    <>
      <p className="portal-eyebrow">YOUR CARE HISTORY</p>
      <h1>
        {kind === "visits"
          ? "My Visits"
          : kind === "appointments"
            ? "Appointments"
            : "My Prescriptions"}
      </h1>
      <p className="portal-muted">
        Only records securely linked to you are shown.
      </p>
      <ol className="portal-history">
        {history.items.map((item) => (
          <li className="portal-panel" key={item.id}>
            <time>
              {item.date.slice(0, 10)} · {item.date.slice(11, 16)}
            </time>
            <h2>{item.type}</h2>
            <p>{item.doctor}</p>
            <p>{item.clinic}</p>
            {"status" in item && <p className="portal-status">{item.status}</p>}
            {kind === "prescriptions" && (
              <Link href={`/patient/prescriptions/${item.id}`}>
                View prescription →
              </Link>
            )}
          </li>
        ))}
      </ol>
      {!history.items.length && (
        <div className="portal-panel">No {kind} available yet.</div>
      )}
      <nav aria-label="History pages" className="portal-pagination">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
        <span>Page {page}</span>
        {history.hasMore && <Link href={`?page=${page + 1}`}>Next</Link>}
      </nav>
    </>
  );
}
