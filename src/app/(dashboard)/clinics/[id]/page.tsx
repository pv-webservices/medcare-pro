import { notFound, redirect } from "next/navigation";
import ClinicDetail from "@/components/clinics/ClinicDetail";
import { getClinicForActor } from "@/lib/clinics";
import { can, ScopeError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

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

  const locked = await moduleLock(actor, MODULE_FEATURES.clinics);
  if (locked) {
    return <ModuleLocked title="Clinic" reason={locked} />;
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
    <section className="space-y-4">
      <ClinicDetail clinic={clinic} canEdit={canEdit} />
    </section>
  );
}
