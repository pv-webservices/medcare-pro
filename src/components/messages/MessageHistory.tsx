import { Info } from "lucide-react";
import type { MessageRecord } from "@/lib/whatsappMessages";

interface MessageHistoryProps {
  messages: readonly MessageRecord[];
}

function formatTimestamp(value: Date): string {
  const d = new Date(value);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export default function MessageHistory({ messages }: MessageHistoryProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-3xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
        <p className="mb-1 font-semibold text-ink">No messages sent yet</p>
        <p className="text-body text-muted">
          Messages you send to patients appear here with their result.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left text-body">
            <thead>
              <tr className="border-b border-line bg-canvas-deep/40">
                <th
                  scope="col"
                  className="py-3.5 pl-6 pr-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Patient
                </th>
                <th
                  scope="col"
                  className="py-3.5 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Template
                </th>
                <th
                  scope="col"
                  className="py-3.5 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Clinic
                </th>
                <th
                  scope="col"
                  className="py-3.5 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Result
                </th>
                <th
                  scope="col"
                  className="py-3.5 pl-4 pr-6 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Sent
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {messages.map((message) => (
                <tr
                  key={message.id}
                  className="transition-colors duration-150 hover:bg-canvas-deep/30"
                >
                  <td className="py-4 pl-6 pr-4 align-top">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-ink text-body">
                        {message.patientName}
                      </p>
                      <p className="text-label text-muted">
                        {message.patientCode}
                      </p>
                      <p className="tnum text-label text-muted">
                        {message.mobileNumber}
                      </p>
                    </div>
                  </td>
                  <td className="py-4 px-4 align-top text-body font-medium text-ink">
                    {message.templateName}
                  </td>
                  <td className="py-4 px-4 align-top text-body text-ink">
                    {message.clinicName}
                  </td>
                  <td className="py-4 px-4 align-top">
                    {message.status === "sent" ? (
                      <span className="inline-flex items-center rounded-xl bg-[#DCFCE7] px-3 py-1 text-label font-semibold text-[#15803D]">
                        Accepted
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center rounded-xl bg-alert-bg px-3 py-1 text-label font-semibold text-alert-ink">
                          Failed
                        </span>
                        {message.failureReason && (
                          <p className="text-micro text-alert-ink">
                            {message.failureReason}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-4 pl-4 pr-6 align-top text-label font-medium tnum text-muted">
                    {formatTimestamp(message.sentAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 pt-1 text-label text-muted max-w-3xl">
        <Info className="h-4 w-4 shrink-0 text-muted mt-0.5" aria-hidden="true" />
        <p>
          &ldquo;Accepted&rdquo; means the WhatsApp gateway took the message. This
          provider does not report back delivered or read receipts, so no further
          status is available.
        </p>
      </div>
    </div>
  );
}
