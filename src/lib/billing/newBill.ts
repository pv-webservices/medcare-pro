import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { PermissionError, type ActorContext } from "@/lib/rbac";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { listRegistrationsForActor } from "@/lib/registrations";

/**
 * The "+ New bill" picker on /billing. No new access path: visits come from the
 * Registrations list function (its registration:read scoping), narrowed to the
 * clinics where the actor may create bills (invoice:create). Read-only.
 */
export type NewBillStatus = "NOT_BILLED" | "DRAFT" | "ISSUED";
export interface NewBillCandidate {
  registrationId: string; patientName: string; patientCode: string; mobileNumber: string;
  visitDate: string; doctorName: string | null; clinicName: string;
  status: NewBillStatus; invoiceId: string | null; invoiceNumber: string | null;
  /** Not billed / Draft → the bill editor; Issued → the bill. */
  href: string;
}

const searchSchema = z.string().trim().max(100);

/** Whether to show "+ New bill" at all: invoice:create in at least one clinic. */
export async function mayStartBills(actor: ActorContext): Promise<boolean> {
  return (await clinicWhereForActor(actor, "invoice:create")) !== null;
}

export async function findVisitsToBill(actor: ActorContext, rawSearch: unknown): Promise<NewBillCandidate[]> {
  await requireModule(actor, MODULE_FEATURES.billing);
  const billable = await clinicWhereForActor(actor, "invoice:create");
  if (!billable) throw new PermissionError("invoice:create");
  const parsed = searchSchema.safeParse(typeof rawSearch === "string" ? rawSearch : "");
  const search = parsed.success ? parsed.data : "";
  const [visits, clinics] = await Promise.all([
    listRegistrationsForActor(actor, { search: search || undefined, page: 1 }, { matchPatientCode: true }),
    prisma.clinic.findMany({ where: billable, select: { id: true } }),
  ]);
  const billableIds = new Set(clinics.map((clinic) => clinic.id));
  const rows = visits.rows.filter((visit) => billableIds.has(visit.clinicId));
  // The live bill (DRAFT or ISSUED) holds the registration id as its activeKey.
  const live = rows.length ? await prisma.invoice.findMany({
    where: { tenantId: actor.tenantId, activeKey: { in: rows.map((visit) => visit.id) } },
    select: { id: true, activeKey: true, status: true, invoiceNumber: true },
  }) : [];
  const byVisit = new Map(live.map((invoice) => [invoice.activeKey, invoice]));
  return rows.map((visit) => {
    const invoice = byVisit.get(visit.id);
    const status: NewBillStatus = !invoice ? "NOT_BILLED" : invoice.status === "ISSUED" ? "ISSUED" : "DRAFT";
    return { registrationId: visit.id, patientName: visit.patientName, patientCode: visit.patientCode, mobileNumber: visit.mobileNumber,
      visitDate: visit.visitDate, doctorName: visit.doctorName, clinicName: visit.clinicName, status,
      invoiceId: invoice?.id ?? null, invoiceNumber: invoice?.invoiceNumber ?? null,
      href: status === "ISSUED" ? `/billing/${invoice!.id}` : `/registration/${visit.id}/bill` };
  });
}
