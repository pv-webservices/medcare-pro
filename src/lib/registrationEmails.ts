import { escapeHtml, sendTransactionalEmail } from "@/lib/email";

/**
 * Applicant notifications for an Owner's decision — Stage 3 item 12.
 *
 * Templates only. Delivery, credentials and error handling stay in
 * src/lib/email.ts, which remains the single place that knows about Resend.
 *
 * WHAT THESE MAILS MAY SAY. The recipient is the address that registered, so
 * naming their own clinic and the decision on it discloses nothing they did not
 * submit. The rejection and suspension mails DO carry the Owner's reason,
 * because a decision the applicant cannot see the grounds for is one they cannot
 * respond to. They carry nothing else: no ids, no plan internals, no other
 * tenant, and never a token or a code.
 */

const SIGN_OFF = "The MEDCARE PRO team";

function loginUrl(): string {
  const origin = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  return origin ? `${origin}/login` : "/login";
}

interface Block {
  heading: string;
  paragraphs: readonly string[];
  /** Rendered as a quoted block. The Owner's words, shown verbatim. */
  quoted?: string | null;
  action?: { label: string; url: string } | null;
}

function render(block: Block): { html: string; text: string } {
  const paragraphsHtml = block.paragraphs
    .map(
      (line) =>
        `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`,
    )
    .join("\n");

  const quotedHtml = block.quoted
    ? `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #ddd;color:#444">${escapeHtml(
        block.quoted,
      )}</blockquote>`
    : "";

  const actionHtml = block.action
    ? `<p style="margin:0 0 24px"><a href="${escapeHtml(
        block.action.url,
      )}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(
        block.action.label,
      )}</a></p>`
    : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(block.heading)}</h1>
      ${paragraphsHtml}
      ${quotedHtml}
      ${actionHtml}
      <p style="margin:0;font-size:13px;color:#555">${escapeHtml(SIGN_OFF)}</p>
    </div>
  `.trim();

  const text = [
    block.heading,
    "",
    ...block.paragraphs,
    ...(block.quoted ? ["", block.quoted] : []),
    // The raw URL, unescaped: escaping would corrupt it in a plain-text body.
    ...(block.action ? ["", `${block.action.label}: ${block.action.url}`] : []),
    "",
    SIGN_OFF,
  ].join("\n");

  return { html, text };
}

export interface DecisionEmailParams {
  to: string;
  clinicName: string;
  /** The Owner's written reason. Required by the two mails that take one. */
  reason?: string;
}

export async function sendRegistrationApprovedEmail(
  params: DecisionEmailParams,
): Promise<void> {
  const { html, text } = render({
    heading: "Your clinic is approved",
    paragraphs: [
      `${params.clinicName} has been approved on MEDCARE PRO.`,
      "You can sign in now with the email and password you registered with.",
    ],
    action: { label: "Sign in", url: loginUrl() },
  });

  await sendTransactionalEmail({
    to: params.to,
    subject: "Your clinic is approved — MEDCARE PRO",
    html,
    text,
  });
}

export async function sendRegistrationRejectedEmail(
  params: DecisionEmailParams & { reason: string },
): Promise<void> {
  const { html, text } = render({
    heading: "About your registration",
    paragraphs: [
      `We were not able to approve the registration for ${params.clinicName}.`,
      "The reason given was:",
    ],
    quoted: params.reason,
  });

  await sendTransactionalEmail({
    to: params.to,
    subject: "Your registration was not approved — MEDCARE PRO",
    html,
    text,
  });
}

export async function sendClinicSuspendedEmail(
  params: DecisionEmailParams & { reason: string },
): Promise<void> {
  const { html, text } = render({
    heading: "Your clinic account is suspended",
    paragraphs: [
      `Access to ${params.clinicName} on MEDCARE PRO has been suspended, for you and for your team.`,
      "The reason given was:",
    ],
    quoted: params.reason,
  });

  await sendTransactionalEmail({
    to: params.to,
    subject: "Your account is suspended — MEDCARE PRO",
    html,
    text,
  });
}

export async function sendClinicReactivatedEmail(
  params: DecisionEmailParams,
): Promise<void> {
  const { html, text } = render({
    heading: "Your clinic account is active again",
    paragraphs: [
      `The suspension on ${params.clinicName} has been lifted.`,
      "You and your team can sign in again.",
    ],
    action: { label: "Sign in", url: loginUrl() },
  });

  await sendTransactionalEmail({
    to: params.to,
    subject: "Your account is active again — MEDCARE PRO",
    html,
    text,
  });
}
