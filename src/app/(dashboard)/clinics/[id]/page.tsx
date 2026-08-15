import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ClinicDetail from "@/components/clinics/ClinicDetail";
import { getClinicForActor } from "@/lib/clinics";
import { can, ScopeError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Clinic detail and edit — PRD §6.2 (FR-2.1).

interface ClinicDetailPageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function ClinicDetailPage({ params }: ClinicDetailPageProps) {
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

  let clinic;
  try {
    clinic = await getClinicForActor(actor, id);
  } catch (error: unknown) {
    // Another tenant's clinic, an unknown id, and one outside this user's
    // clinic scope all render the same 404 — see src/lib/clinics.ts.
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  const canEdit = await can(actor, "clinic:edit", clinic.id);

  return (
    <section>
      <Link
        href="/clinics"
        className="mb-4 inline-block text-sm text-black/60 underline dark:text-white/60"
      >
        ← All clinics
      </Link>

      <ClinicDetail clinic={clinic} canEdit={canEdit} />
    </section>
  );
}
