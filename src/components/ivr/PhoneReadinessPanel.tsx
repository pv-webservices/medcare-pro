import { AlertTriangle, Ban, CheckCircle2 } from "lucide-react";
import Panel from "@/components/ui/Panel";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import { cx } from "@/components/ui/cx";
import type {
  ClinicPhoneReadiness,
  ClinicPhoneSettingsView,
  PhoneReadinessCheck,
  PhoneReadinessStatus,
} from "@/lib/telephony/clinicPhoneSettingsContract";

const ROUTING_LABELS = {
  AUTO: "Automatic",
  OPEN: "Reception",
  AFTER_HOURS: "Phone menu",
} as const;

function statusPresentation(status: PhoneReadinessStatus): {
  label: string;
  tone: StatusTone;
  icon: typeof CheckCircle2;
} {
  if (status === "ready") return { label: "Ready", tone: "ok", icon: CheckCircle2 };
  if (status === "attention") {
    return { label: "Needs attention", tone: "warn", icon: AlertTriangle };
  }
  return { label: "Inactive", tone: "neutral", icon: Ban };
}

function ReadinessItem({ check }: { check: PhoneReadinessCheck }) {
  const presentation = statusPresentation(check.status);
  const Icon = presentation.icon;
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-canvas px-4 py-3.5">
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          check.status === "ready"
            ? "bg-ok-bg text-ok-mark"
            : check.status === "attention"
              ? "bg-warn-bg text-warn-mark"
              : "bg-canvas-deep text-muted",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-label font-semibold text-ink">{check.label}</p>
          <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
        </div>
        <p className="mt-1 text-meta leading-relaxed text-muted">{check.detail}</p>
      </div>
    </li>
  );
}

export default function PhoneReadinessPanel({
  readiness,
  routingMode,
  effectiveRoute,
}: {
  readiness: ClinicPhoneReadiness;
  routingMode: ClinicPhoneSettingsView["routingMode"];
  effectiveRoute: ClinicPhoneSettingsView["effectiveRoute"];
}) {
  const presentation = statusPresentation(readiness.status);
  const checks = [
    readiness.phoneService,
    readiness.automaticHours,
    readiness.reception,
    readiness.urgentTransfer,
    readiness.phoneMenu,
  ];

  return (
    <Panel
      title="Phone readiness"
      description="A server-checked view of the details that affect incoming call routing."
      actions={<StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-canvas-deep px-4 py-3">
          <p className="text-meta font-medium text-muted">Call handling</p>
          <p className="mt-1 text-body font-semibold text-ink">
            {ROUTING_LABELS[routingMode]}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas-deep px-4 py-3">
          <p className="text-meta font-medium text-muted">Current destination</p>
          <p className="mt-1 text-body font-semibold text-ink">
            {effectiveRoute === "RECEPTION"
              ? "Reception"
              : effectiveRoute === "IVR"
                ? "Phone menu"
                : "Inactive"}
          </p>
        </div>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {checks.map((check) => <ReadinessItem key={check.label} check={check} />)}
      </ul>
    </Panel>
  );
}
