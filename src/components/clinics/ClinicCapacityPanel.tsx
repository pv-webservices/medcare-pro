"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Building2, CheckCircle2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input, { Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export interface ClinicCapacityView {
  planId: string | null;
  planName: string | null;
  includedClinics: number;
  activeGrantQuantity: number;
  effectiveLimit: number;
  usedClinics: number;
  remainingClinics: number;
  isAtLimit: boolean;
  isOverLimit: boolean;
  capacityConfigured: boolean;
  usesCompatibilityPlan: boolean;
  compatibilityPlanName: string | null;
  status: "WITHIN_LIMIT" | "AT_LIMIT" | "OVER_LIMIT" | "NO_PLAN";
  additionalClinicPrice: string | null;
  additionalClinicCurrency: string | null;
  additionalClinicBillingInterval: "MONTHLY" | "YEARLY" | "ONE_TIME" | null;
  pendingRequest: {
    id: string;
    requestType: "ADDITIONAL_CLINIC" | "PLAN_UPGRADE";
    requestedQuantity: number | null;
    status: string;
    paymentStatus: string;
    createdAt: string;
    requestedPlan: { name: string; includedClinics: number } | null;
  } | null;
  latestRequest: {
    id: string;
    requestType: "ADDITIONAL_CLINIC" | "PLAN_UPGRADE";
    requestedQuantity: number | null;
    status: string;
    paymentStatus: string;
    rejectionReason: string | null;
    createdAt: string;
    requestedPlan: { name: string; includedClinics: number } | null;
  } | null;
  higherPlans: { id: string; name: string; includedClinics: number }[];
}

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function priceLine(capacity: ClinicCapacityView): string {
  if (!capacity.additionalClinicPrice || !capacity.additionalClinicCurrency) {
    return "Contact MEDCARE PRO for pricing. Pricing will be confirmed before approval.";
  }
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: capacity.additionalClinicCurrency,
    maximumFractionDigits: 2,
  }).format(Number(capacity.additionalClinicPrice));
  const interval = capacity.additionalClinicBillingInterval
    ? ` / ${capacity.additionalClinicBillingInterval === "MONTHLY" ? "month" : capacity.additionalClinicBillingInterval === "YEARLY" ? "year" : "one time"}`
    : "";
  return `${amount}${interval}`;
}

export default function ClinicCapacityPanel({
  capacity,
  canRequest,
}: {
  capacity: ClinicCapacityView;
  canRequest: boolean;
}) {
  const router = useRouter();
  const showToast = useToast();
  const [drawer, setDrawer] = useState<"additional" | "upgrade" | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [planId, setPlanId] = useState(capacity.higherPlans[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!drawer) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/clinic-capacity/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          drawer === "additional"
            ? {
                requestType: "ADDITIONAL_CLINIC",
                requestedQuantity: Number(quantity),
                organizationNote: note,
                paymentReference,
              }
            : {
                requestType: "PLAN_UPGRADE",
                requestedPlanId: planId,
                organizationNote: note,
              },
        ),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not submit the request.");
        return;
      }
      showToast({ tone: "ok", title: "Clinic capacity request submitted.", detail: "MEDCARE PRO will review your request." });
      setDrawer(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!capacity.pendingRequest) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/clinic-capacity/requests/${capacity.pendingRequest.id}/cancel`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        showToast({ tone: "alert", title: body.error ?? "Could not cancel the request." });
        return;
      }
      showToast({ tone: "ok", title: "Clinic capacity request cancelled." });
      router.refresh();
    } catch {
      showToast({ tone: "alert", title: "Could not reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const atLimit = capacity.isAtLimit || !capacity.capacityConfigured;

  return (
    <>
      <div className={`rounded-2xl border p-5 shadow-card ${capacity.isOverLimit ? "border-amber-300 bg-amber-50" : "border-line bg-canvas"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${capacity.isOverLimit ? "bg-amber-100 text-amber-700" : "bg-accent-soft text-accent"}`}>
              {capacity.isOverLimit ? <AlertTriangle className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
            </span>
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-section font-semibold text-ink">
                  {capacity.usedClinics} of {capacity.effectiveLimit} clinics used
                </p>
                <span className="text-label font-medium text-muted">{capacity.planName ?? "No plan assigned"}</span>
              </div>
              <p className="mt-1 text-body text-muted">
                {capacity.planName
                  ? `${capacity.includedClinics} included${capacity.activeGrantQuantity > 0 ? ` + ${capacity.activeGrantQuantity} approved add-on${capacity.activeGrantQuantity === 1 ? "" : "s"}` : ""}`
                  : capacity.usesCompatibilityPlan
                    ? `${capacity.includedClinics} clinics temporarily available from the ${capacity.compatibilityPlanName} compatibility policy. Ask MEDCARE PRO to assign an explicit plan.`
                    : "Clinic capacity needs to be configured by MEDCARE PRO."}
              </p>
              {!atLimit && <p className="mt-1 text-label font-medium text-ok-ink">{capacity.remainingClinics} slot{capacity.remainingClinics === 1 ? "" : "s"} remaining</p>}
            </div>
          </div>
          {!atLimit && <CheckCircle2 aria-label="Within clinic allowance" className="h-5 w-5 shrink-0 text-ok-ink" />}
        </div>

        {capacity.pendingRequest ? (
          <div className="mt-4 rounded-xl border border-line bg-canvas-deep p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-body font-semibold text-ink">Clinic capacity request</p>
                <p className="mt-1 text-label text-muted">
                  {capacity.pendingRequest.requestType === "ADDITIONAL_CLINIC"
                    ? `+${capacity.pendingRequest.requestedQuantity} clinic${capacity.pendingRequest.requestedQuantity === 1 ? "" : "s"}`
                    : `Upgrade to ${capacity.pendingRequest.requestedPlan?.name ?? "selected plan"}`}
                  {" · "}{label(capacity.pendingRequest.status)}{" · submitted "}
                  {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(capacity.pendingRequest.createdAt))}
                </p>
              </div>
              {canRequest && <Button size="sm" variant="ghost" isBusy={busy} onClick={cancelRequest}>Cancel request</Button>}
            </div>
          </div>
        ) : (
          <>
            {capacity.latestRequest && capacity.latestRequest.status !== "CANCELLED" && (
              <div className={`mt-4 rounded-xl border p-4 ${capacity.latestRequest.status === "REJECTED" ? "border-amber-300 bg-amber-50" : "border-line bg-canvas-deep"}`}>
                <p className="text-body font-semibold text-ink">Latest capacity request · {label(capacity.latestRequest.status)}</p>
                <p className="mt-1 text-label text-muted">
                  {capacity.latestRequest.requestType === "ADDITIONAL_CLINIC" ? `+${capacity.latestRequest.requestedQuantity} clinic${capacity.latestRequest.requestedQuantity === 1 ? "" : "s"}` : `Upgrade to ${capacity.latestRequest.requestedPlan?.name ?? "selected plan"}`}
                  {capacity.latestRequest.rejectionReason ? ` · ${capacity.latestRequest.rejectionReason}` : ""}
                </p>
              </div>
            )}
            {atLimit && canRequest && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-body font-semibold text-ink">
              {capacity.isOverLimit ? "Your organization is over its current allowance" : "You've reached your clinic limit"}
            </p>
            <p className="mt-1 max-w-3xl text-body text-muted">
              {capacity.isOverLimit
                ? "All existing clinics remain active. Additional clinics cannot be created until your allowance is increased."
                : `Your ${capacity.planName ?? "current"} plan includes ${capacity.includedClinics} clinics. Request an approved add-on or move to a higher-capacity plan.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {capacity.planId && <Button variant="primary" onClick={() => setDrawer("additional")}>Request another clinic</Button>}
              {capacity.higherPlans.length > 0 && <Button variant="secondary" onClick={() => setDrawer("upgrade")}><ArrowUpRight className="h-4 w-4" />View upgrade options</Button>}
            </div>
          </div>
            )}
          </>
        )}
      </div>

      <Drawer
        isOpen={drawer !== null}
        onClose={() => !busy && setDrawer(null)}
        title={drawer === "upgrade" ? "Request a plan upgrade" : "Request additional clinic capacity"}
        description="A Superadmin reviews the commercial arrangement. After approval, your organization creates and configures its own clinic."
      >
        <form onSubmit={submit} className="space-y-5">
          {error && <p role="alert" className="rounded-xl bg-alert-bg px-4 py-3 text-body text-alert-ink">{error}</p>}
          <div className="rounded-xl bg-canvas-deep p-4 text-body text-muted">
            <p><span className="font-semibold text-ink">Current plan:</span> {capacity.planName}</p>
            <p className="mt-1"><span className="font-semibold text-ink">Usage:</span> {capacity.usedClinics} of {capacity.effectiveLimit}</p>
          </div>

          {drawer === "additional" ? (
            <>
              <Input id="clinic-capacity-quantity" label="Additional clinics requested" type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              <div className="rounded-xl border border-line px-4 py-3">
                <p className="text-label font-semibold text-ink">Additional clinic price</p>
                <p className="mt-1 text-body text-muted">{priceLine(capacity)}</p>
              </div>
              <Input id="clinic-capacity-payment-reference" label="Payment reference (optional)" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} hint="A reference is not proof of payment. MEDCARE PRO must confirm it." />
            </>
          ) : (
            <div>
              <label htmlFor="clinic-upgrade-plan" className="mb-1.5 block text-body font-semibold text-ink">Upgrade option</label>
              <select id="clinic-upgrade-plan" value={planId} onChange={(event) => setPlanId(event.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-body text-ink">
                {capacity.higherPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.includedClinics} clinics</option>)}
              </select>
            </div>
          )}

          <Textarea id="clinic-capacity-note" label="Reason / notes (optional)" value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" isBusy={busy} busyLabel="Submitting…">Submit request</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDrawer(null)}>Cancel</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
