import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getClinicApplication } from "@/lib/platform/applications";
import DecisionPanel from "@/components/owner/DecisionPanel";
import type { TenantStatus } from "@prisma/client";

/**
 * One clinic application, with the Owner's decision controls — Stage 3.
 *
 * The page renders the decision panel but does not authorize it: the panel posts
 * to /api/owner/applications/[id]/decision, which runs requirePlatformOwner()
 * and the whole decision policy again on the server. Rendering a button is not
 * permission to press it.
 */

const STATUS_STYLES: Record<TenantStatus, string> = {
  PENDING: "bg-warn-bg text-warn-ink border-line",
  ACTIVE: "bg-ok-bg text-ok-ink border-line",
  SUSPENDED: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  REJECTED: "bg-alert-bg text-alert-ink border-line",
  ARCHIVED: "bg-pill text-muted border-line",
};

interface PageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );
}

export default async function OwnerApplicationDetailPage({ params }: PageProps) {
  const owner = await requireOwnerPage();
  const { id } = await params;

  const application = await getClinicApplication(owner, id);
  if (!application) {
    // Covers an unknown id and the reserved platform tenant alike.
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/owner/applications?status=${application.status}`}
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to applications
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{application.clinicName}</h1>
          <p className="mt-1 text-xs text-muted">
            Registered {application.createdAt.toISOString().slice(0, 10)}
            {application.slug ? ` · /${application.slug}` : ""}
          </p>
        </div>
        <span
          className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
            STATUS_STYLES[application.status]
          }`}
        >
          {application.status}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 rounded-3xl bg-canvas p-5 sm:grid-cols-2 shadow-neu-raised-sm">
        <Field label="Applicant" value={application.applicantName} />
        <Field label="Login email" value={application.email} />
        <Field label="City" value={application.city} />
        <Field label="Phone" value={application.phone} />
        <Field label="Address" value={application.address} />
        <Field
          label="Business contact email"
          value={application.primaryContactEmail}
        />
        <Field
          label="Email verified"
          value={
            application.emailVerifiedAt
              ? application.emailVerifiedAt.toISOString().slice(0, 10)
              : "Not yet"
          }
        />
        <Field
          label="Terms accepted"
          value={
            application.termsAcceptedAt
              ? application.termsAcceptedAt.toISOString().slice(0, 10)
              : "Not recorded"
          }
        />
        <Field label="Plan" value={application.planName} />
        <Field label="Logins" value={String(application.userCount)} />
      </dl>

      {application.status === "REJECTED" && application.rejectionReason && (
        <p className="mt-4 rounded-xl bg-alert-bg p-4 text-sm text-alert-ink">
          <span className="font-semibold">Rejected: </span>
          {application.rejectionReason}
        </p>
      )}
      {application.status === "SUSPENDED" && application.suspensionReason && (
        <p className="mt-4 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm text-orange-200">
          <span className="font-semibold">Suspended: </span>
          {application.suspensionReason}
        </p>
      )}

      <DecisionPanel
        tenantId={application.id}
        status={application.status}
        emailVerified={application.emailVerifiedAt !== null}
        plans={application.plans}
        currentPlanKey={application.planKey}
        features={application.features}
      />

      {/*
        Stage 9. The decision panel sets entitlements only as part of an
        approval, so before Stage 9 an already-approved organisation could not be
        changed at all without SQL. This link goes to the standalone screen,
        which takes no decision and sends no mail.
      */}
      <Link
        href={`/owner/applications/${application.id}/entitlements`}
        className="mt-4 inline-flex items-center gap-2 rounded-3xl bg-canvas px-4 py-2.5 text-xs font-medium text-muted transition hover: shadow-neu-raised-sm"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Plan and entitlements
      </Link>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Decision history</h2>
        {application.history.length === 0 ? (
          <p className="mt-2 text-xs text-faint">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {application.history.map((record) => (
              <li
                key={record.id}
                className="rounded-2xl bg-canvas px-4 py-3 text-xs shadow-neu-raised-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{record.action}</span>
                  <span className="tabular-nums text-faint">
                    {record.createdAt.toISOString().slice(0, 16).replace("T", "")}
                  </span>
                </div>
                <div className="mt-1 text-muted">
                  {record.actorName ?? "System"}
                  {record.reason ? ` — ${record.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
