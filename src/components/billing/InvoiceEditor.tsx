"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import InvoiceLineBuilder from "./InvoiceLineBuilder";
import type { InvoiceRecord } from "@/lib/billing/invoices";
import type { ServiceItemRecord } from "@/lib/billing/serviceItems";
import { saveInvoiceSchema, type InvoiceLineInput } from "@/lib/billing/invoiceValidation";
import { computeLine, computeTotals, fromPaise } from "@/lib/billing/invoiceMath";
import { formatRupees } from "@/lib/money";

function editable(invoice: InvoiceRecord | null): InvoiceLineInput[] {
  return invoice?.lines.map(({ serviceItemId, description, category, quantity, unitPrice, discountAmount, taxRatePercent, sacCode }) =>
    ({ serviceItemId, description, category, quantity, unitPrice, discountAmount, taxRatePercent, sacCode })) ?? [];
}
export default function InvoiceEditor({ registrationId, initial, services, mayCreate, mayDiscard }: {
  registrationId: string; initial: InvoiceRecord | null; services: ServiceItemRecord[]; mayCreate: boolean; mayDiscard: boolean;
}) {
  const router = useRouter();
  const [invoice, setInvoice] = useState(initial);
  const [lines, setLines] = useState(() => editable(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(editable(initial)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const dirty = JSON.stringify(lines) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a[href]");
      if (link && !window.confirm("Leave this bill and lose unsaved changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  const validation = saveInvoiceSchema.safeParse({ revision: invoice?.revision ?? 0, lines });
  const totals = validation.success ? computeTotals(validation.data.lines.map(computeLine)) : null;
  async function request(url: string, method: string, body: unknown): Promise<InvoiceRecord> {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Could not save this bill.");
    return result.data;
  }
  async function perform(action: "create" | "save" | "issue" | "discard") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "save" && !validation.success) throw new Error(validation.error.issues[0].message);
      const result = action === "create" ? await request(`/api/registrations/${registrationId}/invoice`, "POST", {})
        : action === "save" ? await request(`/api/invoices/${invoice!.id}`, "PUT", validation.success ? validation.data : {})
        : await request(`/api/invoices/${invoice!.id}/${action}`, "POST", action === "issue" ? { revision: invoice!.revision } : {});
      setInvoice(result); setLines(editable(result)); setSaved(JSON.stringify(editable(result)));
      setReview(false); setDiscard(false); setNotice("Draft saved.");
      if (action === "issue") router.push(`/billing/${result.id}`);
      if (action === "discard") router.push(`/registration/${registrationId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The request failed. Your entered content is retained."); }
    finally { setBusy(false); }
  }
  if (!invoice) return <div className="space-y-4"><p>No live bill for this visit.</p>{error && <p role="alert">{error}</p>}{mayCreate && <Button isBusy={busy} onClick={() => perform("create")}>Create bill</Button>}</div>;
  if (invoice.status !== "DRAFT") return <p>Bill {invoice.status.toLowerCase()}.</p>;
  return <div className="space-y-5">
    <p className="text-muted">Draft · {dirty ? "Unsaved changes" : "All changes saved"}</p>
    {error && <p role="alert" className="text-alert-ink">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !mayCreate} className="space-y-4">
      {lines.map((line, index) => <InvoiceLineBuilder key={index} line={line} index={index}
        onChange={(next) => setLines(lines.map((old, i) => i === index ? next : old))} onRemove={() => setLines(lines.filter((_, i) => i !== index))} />)}
      <div className="flex flex-wrap items-end gap-3">
        <Select id="bill-service" label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}><option value="">Select service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {formatRupees(service.price)}</option>)}</Select>
        <Button variant="secondary" disabled={!serviceId} onClick={() => { const service = services.find((item) => item.id === serviceId)!; setLines([...lines, { serviceItemId: service.id, description: service.name, category: service.category, quantity: 1, unitPrice: service.price, discountAmount: "0.00", taxRatePercent: service.taxRatePercent, sacCode: service.sacCode }]); }}>Add service</Button>
        <Button variant="secondary" onClick={() => setLines([...lines, { serviceItemId: null, description: "", category: "OTHER", quantity: 1, unitPrice: "0.00", discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }])}>Add custom line</Button>
      </div>
    </fieldset>
    {totals ? <dl className="grid gap-3 rounded-2xl bg-canvas-deep p-4 sm:grid-cols-3">{Object.entries(totals).map(([key, value]) => <div key={key}><dt className="capitalize text-muted">{key.replace(/([A-Z])/g, " $1")}</dt><dd className="font-semibold">{formatRupees(fromPaise(value))}</dd></div>)}</dl>
      : <p role="alert">{validation.success ? "Check the line amounts." : validation.error.issues[0].message}</p>}
    <div className="flex flex-wrap gap-3">
      {mayCreate && <><Button isBusy={busy} disabled={!validation.success} onClick={() => perform("save")}>Save draft</Button><Button variant="secondary" disabled={busy || dirty || !lines.length || !validation.success} onClick={() => setReview(true)}>Review bill</Button></>}
      {mayDiscard && <Button variant="danger" disabled={busy} onClick={() => setDiscard(true)}>Discard draft</Button>}
    </div>
    <Modal isOpen={review} onClose={() => setReview(false)} title="Review bill" isBusy={busy}
      footer={<><Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>Back</Button><Button isBusy={busy} onClick={() => perform("issue")}>Issue bill</Button></>}>
      <p>Issuing assigns the invoice number and freezes this bill. Confirm the saved lines and total.</p>
      <ul className="my-4 space-y-2">{invoice.lines.map((line) => <li key={line.position}>{line.description} · {line.quantity} × {formatRupees(line.unitPrice)} · discount {formatRupees(line.discountAmount)} · GST {line.taxRatePercent}% · {formatRupees(line.lineTotal)}</li>)}</ul>
      <p className="font-bold">Grand total: {formatRupees(invoice.totals.grandTotal)}</p>{error && <p role="alert">{error}</p>}
    </Modal>
    <Modal isOpen={discard} onClose={() => setDiscard(false)} title="Discard draft?" isBusy={busy}
      footer={<Button variant="dangerSolid" isBusy={busy} onClick={() => perform("discard")}>Discard draft</Button>}>
      <p>This draft will be cancelled without an invoice number.</p>{error && <p role="alert">{error}</p>}
    </Modal>
  </div>;
}
