import type { MessageRecord } from "@/lib/whatsappMessages";

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
      <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
        <p className="mb-1 font-medium">No messages sent yet</p>
        <p className="text-sm text-black/60 dark:text-white/60">
          Messages you send to patients appear here with their result.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/15 text-left dark:border-white/20">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Patient
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Template
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Clinic
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Result
              </th>
              <th scope="col" className="py-2 font-semibold">
                Sent
              </th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr
                key={message.id}
                className="border-b border-black/10 last:border-b-0 dark:border-white/10"
              >
                <td className="py-2 pr-3">
                  <span className="font-medium">{message.patientName}</span>{" "}
                  <span className="text-black/55 dark:text-white/55">
                    {message.patientCode}
                  </span>
                  <span className="block tabular-nums text-black/55 dark:text-white/55">
                    {message.mobileNumber}
                  </span>
                </td>
                <td className="py-2 pr-3">{message.templateName}</td>
                <td className="py-2 pr-3">{message.clinicName}</td>
                <td className="py-2 pr-3">
                  {message.status === "sent" ? (
                    <span className="font-medium">Accepted</span>
                  ) : (
                    <>
                      {/* Red is reserved for things needing action — a failed
                          send is exactly that. */}
                      <span className="font-medium text-red-700 dark:text-red-400">
                        Failed
                      </span>
                      {message.failureReason && (
                        <span className="block text-black/60 dark:text-white/60">
                          {message.failureReason}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-2 tabular-nums text-black/60 dark:text-white/60">
                  {formatTimestamp(message.sentAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-black/60 dark:text-white/60">
        &ldquo;Accepted&rdquo; means the WhatsApp gateway took the message. This
        provider does not report back delivered or read receipts, so no further
        status is available.
      </p>
    </div>
  );
}
