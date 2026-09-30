import { redirect } from "next/navigation";
import InvoiceEditor from "@/components/billing/InvoiceEditor";
import { billingPage } from "@/lib/billing/billingPages";
import { getInvoiceEditorForRegistration } from "@/lib/billing/invoices";

export const dynamic = "force-dynamic";
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await billingPage((actor) => getInvoiceEditorForRegistration(actor, id));
  if (context.invoice?.status === "ISSUED") redirect(`/billing/${context.invoice.id}`);
  return <section className="space-y-5"><header><h1 className="text-2xl font-bold">Bill for {context.patientName}</h1><p className="text-muted">{context.clinicName} · Registration / visit</p></header>
    <InvoiceEditor registrationId={id} initial={context.invoice} services={context.services} mayCreate={context.mayCreate} mayDiscard={context.mayDiscard} mayManageServices={context.mayManageServices} />
  </section>;
}
