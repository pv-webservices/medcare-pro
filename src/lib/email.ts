import { Resend } from "resend";

/**
 * Transactional email via Resend — FR-1.2 (signup verification).
 *
 * Reads EMAIL_API_KEY and EMAIL_FROM_ADDRESS from the environment. The client
 * is created lazily rather than at module scope so that importing this file
 * (which Next does at build time) does not throw when the key is absent.
 *
 * Resend RETURNS errors rather than throwing them — `emails.send` resolves to
 * `{ data, error }`. Every call here checks `error` explicitly and converts it
 * into a thrown EmailDeliveryError, so a caller cannot mistake a failed send
 * for a successful one. FR-1.2 depends on that: a signup that reports success
 * without delivering the link strands the account permanently unverifiable.
 */

const NOT_CONFIGURED =
  "Email is not configured — set EMAIL_API_KEY and EMAIL_FROM_ADDRESS.";

/** Thrown on any delivery failure. Routes map this to a 502. */
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

let client: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailDeliveryError(NOT_CONFIGURED);
  }
  client ??= new Resend(apiKey);
  return client;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM_ADDRESS?.trim();
  if (!from) {
    throw new EmailDeliveryError(NOT_CONFIGURED);
  }
  return from;
}

export interface SendVerificationEmailParams {
  /** Address collected at signup — the Tenant's contact email. */
  to: string;
  /** Business name, for the greeting. */
  businessName: string;
  /** Fully-qualified link to the verify-email route carrying the token. */
  verificationUrl: string;
}

/**
 * Minimal escaping for the two caller-supplied values interpolated into the
 * HTML body. `businessName` comes from user input at signup, so it reaches this
 * template unfiltered — without escaping, a business name containing markup
 * would be injected into the email we send.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildVerificationBody(
  businessName: string,
  verificationUrl: string,
): { html: string; text: string } {
  const safeName = escapeHtml(businessName);
  const safeUrl = escapeHtml(verificationUrl);

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <h1 style="font-size:20px;margin:0 0 16px">Verify your email</h1>
      <p style="margin:0 0 16px">
        Hello ${safeName}, confirm this address to activate your MEDCARE PRO account.
      </p>
      <p style="margin:0 0 24px">
        <a href="${safeUrl}"
           style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">
          Verify email
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">
        Or paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all">${safeUrl}</p>
      <p style="margin:0;font-size:13px;color:#555">
        You cannot log in until this address is verified. If you did not create
        this account, ignore this email.
      </p>
    </div>
  `.trim();

  // Plain-text alternative uses the raw URL: escaping would corrupt it here.
  const text = [
    `Hello ${businessName},`,
    "",
    "Confirm this address to activate your MEDCARE PRO account:",
    verificationUrl,
    "",
    "You cannot log in until this address is verified.",
    "If you did not create this account, ignore this email.",
  ].join("\n");

  return { html, text };
}

async function deliver(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const resend = getClient();

  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });

  // Resend reports failures in the resolved value, not by throwing.
  if (error) {
    throw new EmailDeliveryError(error.message);
  }
}

/**
 * Sends the FR-1.2 verification link. Called by `api/auth/signup` after the
 * Tenant/User rows and the VerificationToken are committed.
 */
export async function sendVerificationEmail(
  params: SendVerificationEmailParams,
): Promise<void> {
  const { html, text } = buildVerificationBody(
    params.businessName,
    params.verificationUrl,
  );

  await deliver({
    to: params.to,
    subject: "Verify your email — MEDCARE PRO",
    html,
    text,
  });
}

/**
 * Re-sends the verification link — FR-1.5's resend option, offered on the login
 * page when an unverified account attempts to sign in.
 */
export async function resendVerificationEmail(
  params: SendVerificationEmailParams,
): Promise<void> {
  const { html, text } = buildVerificationBody(
    params.businessName,
    params.verificationUrl,
  );

  await deliver({
    to: params.to,
    subject: "Your new verification link — MEDCARE PRO",
    html,
    text,
  });
}
