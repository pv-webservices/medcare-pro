import { escapeHtml, sendTransactionalEmail } from "@/lib/email";

/**
 * The invitation mail — Stage 6.
 *
 * Template only. Delivery, credentials and error handling stay in
 * src/lib/email.ts, which remains the single place that knows about Resend.
 *
 * WHAT THIS MAIL MAY SAY. It names the organisation and the role, because the
 * recipient has to know who is asking and what they are being asked to be —
 * an unattributed "someone invited you" link is indistinguishable from
 * phishing. It carries no user ids, no other members, no clinic data, and no
 * password.
 *
 * IT DOES CARRY A LIVE CREDENTIAL. The token in the URL is the only thing that
 * authorises acceptance, which is why the link cannot complete anything on its
 * own: following it opens a form that still demands a name and a password. A
 * mail scanner that prefetches the URL therefore consumes nothing — the worst
 * it does is stamp `openedAt`.
 *
 * `invitationUrl` is built by the caller and is never logged.
 */

const SIGN_OFF = "The MEDCARE PRO team";

export interface InvitationEmailParams {
  to: string;
  /** The organisation doing the inviting. */
  businessName: string;
  /** The role the invitation proposes, by display name. */
  roleName: string;
  /** The clinic the role is scoped to, or null for organisation-wide. */
  clinicName: string | null;
  /** Who sent it, for attribution. Falls back to the organisation's name. */
  invitedByName: string | null;
  invitationUrl: string;
  expiresInDays: number;
}

function buildBody(params: InvitationEmailParams): { html: string; text: string } {
  const inviter = params.invitedByName?.trim() || params.businessName;
  const scope = params.clinicName
    ? `${params.roleName} at ${params.clinicName}`
    : `${params.roleName}, across the whole account`;

  const lines = [
    `${inviter} has invited you to join ${params.businessName} on MEDCARE PRO.`,
    `You have been invited as: ${scope}.`,
    "Follow the link below to choose a password and finish setting up your login.",
  ];

  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`)
    .join("\n");

  const safeUrl = escapeHtml(params.invitationUrl);

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <h1 style="font-size:20px;margin:0 0 16px">Join ${escapeHtml(
        params.businessName,
      )} on MEDCARE PRO</h1>
      ${paragraphs}
      <p style="margin:0 0 24px">
        <a href="${safeUrl}"
           style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">
          Accept invitation
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">
        Or paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all">${safeUrl}</p>
      <p style="margin:0 0 16px;font-size:13px;color:#555">
        The invitation expires in ${params.expiresInDays} days and can be used once.
        If you were not expecting it, ignore this email — nothing happens until
        you set a password.
      </p>
      <p style="margin:0;font-size:13px;color:#555">${escapeHtml(SIGN_OFF)}</p>
    </div>
  `.trim();

  const text = [
    `Join ${params.businessName} on MEDCARE PRO`,
    "",
    ...lines,
    "",
    // Raw URL: escaping would corrupt it in a plain-text body.
    params.invitationUrl,
    "",
    `The invitation expires in ${params.expiresInDays} days and can be used once.`,
    "If you were not expecting it, ignore this email — nothing happens until you set a password.",
    "",
    SIGN_OFF,
  ].join("\n");

  return { html, text };
}

/**
 * Injected as a function rather than imported directly by lib/invitations.ts,
 * so the verification script and tests can substitute a capture function and
 * never send real mail — the same arrangement Stage 4 uses for login codes.
 */
export type InvitationMailer = (params: InvitationEmailParams) => Promise<void>;

export const sendInvitationEmail: InvitationMailer = async (params) => {
  const { html, text } = buildBody(params);

  await sendTransactionalEmail({
    to: params.to,
    subject: `You are invited to join ${params.businessName} — MEDCARE PRO`,
    html,
    text,
  });
};
