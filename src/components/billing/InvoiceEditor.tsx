"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import InvoiceLineBuilder from "./InvoiceLineBuilder";
import InvoiceDocument from "./InvoiceDocument";
import { rememberIssued } from "./IssuedNotice";
import type { InvoiceRecord } from "@/lib/billing/invoices";
import type { ServiceItemRecord } from "@/lib/billing/serviceItems";
import type { InvoicePreview } from "@/lib/billing/invoiceDetail";
import { saveInvoiceSchema, type InvoiceLineInput } from "@/lib/billing/invoiceValidation";
import { computeLine, computeTotals, fromPaise } from "@/lib/billing/invoiceMath";
import { formatRupees } from "@/lib/money";
import { friendlyBillingIssue, friendlyBillingMessage } from "@/lib/billing/billingMessages";
import { invoiceTotalRows } from "@/lib/billing/billingLabels";

function editable(invoice: InvoiceRecord | null): InvoiceLineInput[] {
  return invoice?.lines.map(({ serviceItemId, description, category, quantity, unitPrice, discountAmount, taxRatePercent, sacCode }) =>
    ({ serviceItemId, description, category, quantity, unitPrice, discountAmount, taxRatePercent, sacCode })) ?? [];
}
export default function InvoiceEditor({ registrationId, initial, services, mayCreate, mayDiscard, mayManageServices = false }: {
  registrationId: string; initial: InvoiceRecord | null; services: ServiceItemRecord[]; mayCreate: boolean; mayDiscard: boolean;
  /** Links an empty price list to Settings → Billing; display only. */
  mayManageServices?: boolean;
}) {
  const router = useRouter();
  const [invoice, setInvoice] = useState(initial);
  const [lines, setLines] = useState(() => editable(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(editable(initial)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
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
  async function request<T = InvoiceRecord>(url: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(url, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error || "Could not save this bill.");
    return result.data;
  }
  function accept(result: InvoiceRecord) {
    setInvoice(result); setLines(editable(result)); setSaved(JSON.stringify(editable(result)));
  }
  const failureText = (failure: unknown) => failure instanceof Error ? friendlyBillingMessage(failure.message) : "The request failed. Your entered content is retained.";
  /** Review = save what's on screen (if anything changed), then show the saved draft as the server will issue it. */
  async function openReview() {
    setBusy(true); setError(""); setNotice(""); setReviewError("");
    try {
      let current = invoice!;
      if (dirty) {
        if (!validation.success) { setShowErrors(true); throw new Error(friendlyBillingIssue(validation.error.issues[0])); }
        current = await request(`/api/invoices/${current.id}`, "PUT", validation.data);
        accept(current);
      }
      setPreview(await request<InvoicePreview>(`/api/invoices/${current.id}/preview`, "GET"));
    } catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  async function issue() {
    setBusy(true); setReviewError("");
    try {
      const issued = await request(`/api/invoices/${invoice!.id}/issue`, "POST", { revision: preview!.revision });
      if (issued.invoiceNumber) rememberIssued(issued.id, issued.invoiceNumber);
      router.push(`/billing/${issued.id}`);
    } catch (failure) { setReviewError(failureText(failure)); setBusy(false); }
  }
  async function perform(action: "create" | "save" | "discard") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "save" && !validation.success) { setShowErrors(true); throw new Error(friendlyBillingIssue(validation.error.issues[0])); }
      const result = action === "create" ? await request(`/api/registrations/${registrationId}/invoice`, "POST", {})
        : action === "save" ? await request(`/api/invoices/${invoice!.id}`, "PUT", validation.success ? validation.data : {})
        : await request(`/api/invoices/${invoice!.id}/${action}`, "POST", {});
      accept(result);
      setDiscard(false); setNotice("Draft saved.");
      if (action === "discard") router.push(`/registration/${registrationId}`);
    } catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  if (!invoice) return <div className="space-y-4"><p>No live bill for this visit.</p>{error && <p role="alert">{error}</p>}{mayCreate && <Button isBusy={busy} onClick={() => perform("create")}>Create bill</Button>}</div>;
  if (invoice.status !== "DRAFT") return <p>Bill {invoice.status.toLowerCase()}.</p>;
  return <div className="space-y-5">
    <p className="text-muted">Draft · {dirty ? "not saved yet" : "saved"}</p>
    {error && <p role="alert" className="text-alert-ink">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !mayCreate} className="space-y-4">
      {lines.map((line, index) => <InvoiceLineBuilder key={index} line={line} index={index} showErrors={showErrors}
        onChange={(next) => setLines(lines.map((old, i) => i === index ? next : old))} onRemove={() => setLines(lines.filter((_, i) => i !== index))} />)}
      <div className="flex flex-wrap items-end gap-3">
        {services.length === 0
          ? <p role="note" className="rounded-2xl border border-line bg-canvas-deep px-4 py-3 text-body">
            {mayManageServices
              ? <>No services yet. Add your price list in <Link href="/settings/billing" className="font-semibold text-accent underline">Settings → Billing</Link>, or use Add custom line.</>
              : "No services yet. Ask an admin to add services, or use Add custom line."}
          </p>
          : <><Select id="bill-service" label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}><option value="">Select service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} — {formatRupees(service.price)}</option>)}</Select>
        <Button variant="secondary" disabled={!serviceId} onClick={() => { const service = services.find((item) => item.id === serviceId)!; setLines([...lines, { serviceItemId: service.id, description: service.name, category: service.category, quantity: 1, unitPrice: service.price, discountAmount: "0.00", taxRatePercent: service.taxRatePercent, sacCode: service.sacCode }]); setServiceId(""); }}>Add service</Button></>}
        <Button variant="secondary" onClick={() => setLines([...lines, { serviceItemId: null, description: "", category: "OTHER", quantity: 1, unitPrice: "0.00", discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }])}>Add custom line</Button>
      </div>
    </fieldset>
    {totals ? <dl className="grid gap-3 rounded-2xl bg-canvas-deep p-4 sm:grid-cols-3">{invoiceTotalRows(totals).map(({ key, label, value }) => <div key={key}><dt className="text-muted">{label}</dt><dd className="font-semibold">{formatRupees(fromPaise(value))}</dd></div>)}</dl>
      : <p role="alert">{validation.success ? "Check the line amounts." : friendlyBillingIssue(validation.error.issues[0])}</p>}
    <div className="flex flex-wrap gap-3">
      {mayCreate && <><Button isBusy={busy} disabled={!validation.success} onClick={() => perform("save")}>Save draft</Button><Button variant="secondary" disabled={busy || !lines.length} onClick={openReview}>Review bill</Button></>}
      {mayDiscard && <Button variant="danger" disabled={busy} onClick={() => setDiscard(true)}>Discard draft</Button>}
    </div>
    <Modal isOpen={preview !== null} onClose={() => { setPreview(null); setReviewError(""); }} title="Review bill" size="xl" isBusy={busy}
      description="This is the saved draft exactly as it will be issued."
      footer={<><Button variant="secondary" disabled={busy} onClick={() => { setPreview(null); setReviewError(""); }}>Back to edit</Button><Button variant="primary" isBusy={busy} onClick={issue}>Issue bill</Button></>}>
      {preview && <div className="space-y-4">
        <div role="note" className="rounded-2xl border border-warn-line bg-warn-bg p-4 text-warn-ink">
          Once issued, this bill gets a number (e.g. {preview.numberExample}) and can&apos;t be edited. Mistakes are fixed by cancelling and creating a replacement.
        </div>
        {reviewError && <p role="alert" className="text-alert-ink">{reviewError}</p>}
        <InvoiceDocument snapshot={preview.preview} />
      </div>}
    </Modal>
    <Modal isOpen={discard} onClose={() => setDiscard(false)} title="Discard draft?" isBusy={busy}
      footer={<Button variant="dangerSolid" isBusy={busy} onClick={() => perform("discard")}>Discard draft</Button>}>
      <p>This draft will be cancelled without an invoice number.</p>{error && <p role="alert">{error}</p>}
    </Modal>
  </div>;
}
