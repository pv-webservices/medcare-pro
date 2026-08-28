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
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

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

  const locked = await moduleLock(actor, MODULE_FEATURES.registrations);
  if (locked) {
    return <ModuleLocked title="Edit history" reason={locked} />;
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
    <section className="space-y-4">
      <PageHeader
        breadcrumbs={[
          { label: "Registrations", href: "/registration" },
          {
            label: registration.patientCode,
            href: `/registration/${registration.id}`,
          },
          { label: "Edit history" },
        ]}
        title="Edit history"
        description={`Every recorded change to ${registration.patientName}. Nothing here can be edited or removed.`}
      />

      {entries === null ? (
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view edit history. Ask an admin or the account owner
          if you need to see who changed this registration.
        </div>
      ) : (
        <EditHistory entries={entries} />
      )}
    </section>
  );
}
