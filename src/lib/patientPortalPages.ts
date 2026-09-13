import { notFound, redirect } from "next/navigation";
import {
  requirePatientActor,
  type PatientActorContext,
} from "@/lib/patientPortalSession";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
export async function patientPortalPage<T>(
  load: (actor: PatientActorContext) => Promise<T>,
): Promise<T> {
  try {
    return await load(await requirePatientActor());
  } catch (e) {
    if (e instanceof PatientPortalError) {
      if (e.status === 401) redirect("/patient/login");
      if (e.status === 404) notFound();
      redirect("/patient/unavailable");
    }
    throw e;
  }
}
