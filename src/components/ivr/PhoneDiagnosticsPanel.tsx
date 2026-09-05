import { Activity, PhoneIncoming } from "lucide-react";
import Panel from "@/components/ui/Panel";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import type {
  PhoneDiagnosticsHealthStatus,
  PhoneDiagnosticsView,
  ProductionCallDiagnosticView,
} from "@/lib/telephony/callDiagnosticsContract";

const HEALTH_LABELS: Record<PhoneDiagnosticsHealthStatus, string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  "no-data": "No recent calls",
};

function healthTone(status: PhoneDiagnosticsHealthStatus): StatusTone {
  if (status === "healthy") return "ok";
  if (status === "attention") return "warn";
  return "neutral";
}

function callTone(status: ProductionCallDiagnosticView["status"]): StatusTone {
  if (status === "COMPLETED") return "ok";
  if (status === "INCOMPLETE") return "warn";
  return "neutral";
}

function callStatus(status: ProductionCallDiagnosticView["status"]): string {
  if (status === "COMPLETED") return "Completed";
  if (status === "INCOMPLETE") return "Incomplete";
  return "Active";
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export default function PhoneDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: PhoneDiagnosticsView;
}) {
  const health = diagnostics.health;
  const detail =
    health.status === "no-data"
      ? "No production calls have been observed in the last 24 hours."
      : health.status === "attention"
        ? "Recent call-flow telemetry includes an incomplete call or transfer problem."
        : "Recent observed call flows have no detected operational issue.";

  return (
    <Panel
      title="Phone diagnostics"
      description="Privacy-conscious operational activity from signed production call callbacks."
      actions={<StatusPill tone={healthTone(health.status)}>{HEALTH_LABELS[health.status]}</StatusPill>}
    >
      <div className="rounded-2xl border border-line bg-canvas-deep px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-body font-semibold text-ink">{HEALTH_LABELS[health.status]}</p>
            <p className="mt-1 text-meta leading-relaxed text-muted">{detail}</p>
            <p className="mt-2 text-meta font-medium text-muted">Times shown in {diagnostics.timezone}</p>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Calls observed", health.recentCalls],
          ["Incomplete", health.incompleteCalls],
          ["Reception issues", health.receptionFailures],
          ["Urgent issues", health.urgentTransferFailures],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-canvas px-4 py-3">
            <dt className="text-meta text-muted">{label}</dt>
            <dd className="mt-1 text-title font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-body font-semibold text-ink">Recent activity</h3>
          <span className="text-meta text-muted">Last 24 hours</span>
        </div>
        {diagnostics.recentCalls.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line px-4 py-6 text-center">
            <PhoneIncoming aria-hidden="true" className="mx-auto h-5 w-5 text-muted" />
            <p className="mt-2 text-label font-medium text-muted">No production call activity is available yet.</p>
          </div>
        ) : (
          <ol className="mt-3 space-y-3">
            {diagnostics.recentCalls.map((call) => (
              <li key={call.id} className="rounded-2xl border border-line bg-canvas px-4 py-3.5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-label font-semibold text-ink">
                      {call.callerNumber ? (
                        <a href={`tel:${call.callerNumber}`} className="hover:text-accent hover:underline">
                          {call.callerLabel}
                        </a>
                      ) : call.callerLabel}
                    </p>
                    <p className="mt-1 text-meta text-muted">
                      {formatTime(call.startedAt, diagnostics.timezone)} · {call.initialRoute === "RECEPTION" ? "Reception" : call.initialRoute === "IVR" ? "Phone menu" : "Route unavailable"} · {formatDuration(call.durationSeconds)}
                    </p>
                  </div>
                  <StatusPill tone={callTone(call.status)}>{callStatus(call.status)}</StatusPill>
                </div>
                {call.highlights.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label="Call highlights">
                    {call.highlights.map((highlight) => (
                      <li key={highlight} className="rounded-full bg-canvas-deep px-2.5 py-1 text-meta text-muted">{highlight}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
