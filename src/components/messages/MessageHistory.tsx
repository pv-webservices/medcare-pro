import type { MessageRecord } from "@/lib/whatsappMessages";
import Card from "@/components/ui/Card";

/**
 * What went out — PRD §6.9 (FR-9.2).
 *
 * "Sent" here means the gateway accepted the message, NOT that WhatsApp
 * delivered it or that the patient read it. RkvRobo has no delivery-status
 * callback, so no delivered/read state is ever reported back to us. The column
 * heading and the note below it say so plainly rather than showing a tick that
 * would be read as delivery confirmation.
 *
 * Failures carry the gateway's own reason, because "failed" alone gives the
 * front desk nothing to act on — a wrong number and a disconnected device need
 * different fixes.
 */

interface MessageHistoryProps {
  messages: readonly MessageRecord[];
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageHistory({ messages }: MessageHistoryProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
        <p className="mb-1 font-semibold text-ink">No messages sent yet</p>
        <p className="text-sm text-muted">
          Messages you send to patients appear here with their result.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Card isFlush>
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas-deep/50">
              <th scope="col" className="py-3 pl-4 pr-3 font-semibold text-ink">
                Patient
              </th>
              <th scope="col" className="py-3 pr-3 font-semibold text-ink">
                Template
              </th>
              <th scope="col" className="py-3 pr-3 font-semibold text-ink">
                Clinic
              </th>
              <th scope="col" className="py-3 pr-3 font-semibold text-ink">
                Result
              </th>
              <th scope="col" className="py-3 pr-4 font-semibold text-ink">
                Sent
              </th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr
                key={message.id}
                className="border-b border-line last:border-b-0 hover:bg-canvas-deep/50 transition-colors"
              >
                <td className="py-3 pl-4 pr-3">
                  <span className="font-medium text-ink">{message.patientName}</span>{""}
                  <span className="text-muted">
                    {message.patientCode}
                  </span>
                  <span className="block tabular-nums text-muted">
                    {message.mobileNumber}
                  </span>
                </td>
                <td className="py-3 pr-3 text-ink">{message.templateName}</td>
                <td className="py-3 pr-3 text-ink">{message.clinicName}</td>
                <td className="py-3 pr-3">
                  {message.status === "sent" ? (
                    <span className="inline-flex items-center rounded-md bg-ok-bg px-2 py-1 text-xs font-medium text-ok-ink ring-1 ring-inset ring-ok-mark/30">Accepted</span>
                  ) : (
                    <>
                      {/* Red is reserved for things needing action — a failed
                          send is exactly that. */}
                      <span className="inline-flex items-center rounded-md bg-alert-bg px-2 py-1 text-xs font-medium text-alert-ink ring-1 ring-inset ring-alert-mark/30">
                        Failed
                      </span>
                      {message.failureReason && (
                        <span className="mt-1 block text-muted">
                          {message.failureReason}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-3 pr-4 tabular-nums text-muted">
                  {formatTimestamp(message.sentAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 text-xs text-muted max-w-3xl">
        &ldquo;Accepted&rdquo; means the WhatsApp gateway took the message. This
        provider does not report back delivered or read receipts, so no further
        status is available.
      </p>
    </div>
  );
}
