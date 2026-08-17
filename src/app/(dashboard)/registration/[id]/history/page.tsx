import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import EditHistory from "@/components/registration/EditHistory";
import PageHeader from "@/components/ui/PageHeader";
import { PermissionError, ScopeError } from "@/lib/rbac";
import {
  getRegistrationForActor,
  listEditHistoryForActor,
  type EditLogEntry,
} from "@/lib/registrations";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Edit audit trail — PRD §6.3 (FR-3.6). Owner/Admin only.
//
// Staff hold `registration:edit` but not `registration:history:read`: their
// edits are logged and they simply cannot read the log back. That check runs in
// src/lib/registrations.ts, so reaching this URL directly is refused the same
// way the API refuses it — this page only decides how the refusal looks.

interface RegistrationHistoryPageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function RegistrationHistoryPage({
  params,
}: RegistrationHistoryPageProps) {
  const { id } = await params;

  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  let registration;
  try {
    registration = await getRegistrationForActor(actor, id);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  let entries: EditLogEntry[] | null = null;
  try {
    entries = await listEditHistoryForActor(actor, id);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      notFound();
    }
    // Visible record, but the trail is not theirs to read.
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <PageHeader
        back={{ href: `/registration/${registration.id}`, label: "Back to registration" }}
        title="Edit history"
        meta={`${registration.patientCode} · ${registration.patientName}`}
      />

      {entries === null ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
          Your role cannot view edit history. Ask an admin or the account owner
          if you need to see who changed this registration.
        </div>
      ) : (
        <EditHistory entries={entries} />
      )}
    </section>
  );
}
