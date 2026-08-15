import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import EditHistory from "@/components/registration/EditHistory";
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
    <section>
      <Link
        href={`/registration/${registration.id}`}
        className="mb-4 inline-block text-sm text-black/60 underline dark:text-white/60"
      >
        ← Back to registration
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Edit history</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {registration.patientCode} · {registration.patientName}
        </p>
      </div>

      {entries === null ? (
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot view edit history. Ask an admin or the account owner
          if you need to see who changed this registration.
        </p>
      ) : (
        <EditHistory entries={entries} />
      )}
    </section>
  );
}
