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
export function escapeHtml(value: string): string {
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
 * The transport, for templates that live elsewhere — Stage 3's registration
 * decision mail is in src/lib/registrationEmails.ts.
 *
 * This file stays the only place that knows about Resend, the API key, the from
 * address, and the fact that a failure arrives in the resolved value rather than
 * as a throw. A caller gets one guarantee: it returns, or it throws
 * EmailDeliveryError. Nothing in between.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  await deliver(params);
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

export interface SendLoginCodeEmailParams {
  to: string;
  /** The six digits. Held in memory for this call only — never stored or logged. */
  code: string;
  expiresInMinutes: number;
}

/**
 * Stage 4 — the six-digit login code.
 *
 * NO CLICKABLE LINK, deliberately. A one-click "log me in" link is a different
 * threat model from a code the user retypes: it turns every forwarded, cached or
 * link-previewed message into a live credential, and mail scanners that fetch
 * URLs would consume the login on the user's behalf. Requiring the digits to be
 * typed back into a page the user already has open keeps possession of the inbox
 * necessary but not sufficient.
 *
 * The code is NOT in the subject line either. Subjects show up in lock-screen
 * notifications and sync to devices that the body does not always reach.
 */
function buildLoginCodeBody(
  code: string,
  expiresInMinutes: number,
): { html: string; text: string } {
  // The code is generated from a fixed digit alphabet, so it cannot carry
  // markup. Escaped anyway: this template must stay safe if the generator is
  // ever widened to alphanumerics.
  const safeCode = escapeHtml(code);

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <h1 style="font-size:20px;margin:0 0 16px">Your MEDCARE PRO login code</h1>
      <p style="margin:0 0 16px">Enter this code to finish signing in:</p>
      <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:6px">
        ${safeCode}
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#555">
        It expires in ${expiresInMinutes} minutes and can be used once.
      </p>
      <p style="margin:0;font-size:13px;color:#555">
        MEDCARE PRO staff will never ask you for this code. Do not share it with
        anyone. If you did not try to sign in, ignore this email — nobody can use
        the code without it.
      </p>
    </div>
  `.trim();

  const text = [
    "Your MEDCARE PRO login code:",
    "",
    code,
    "",
    `It expires in ${expiresInMinutes} minutes and can be used once.`,
    "",
    "MEDCARE PRO staff will never ask you for this code. Do not share it with anyone.",
    "If you did not try to sign in, ignore this email.",
  ].join("\n");

  return { html, text };
}

/**
 * Sends the Stage 4 login code. Called by src/lib/loginCode.ts, which passes
 * this function in as its mailer — so tests and the verification script can
 * substitute a capture function and never send real mail.
 *
 * The rendered body is never logged: it contains the one secret in the flow.
 */
export async function sendLoginCodeEmail(
  params: SendLoginCodeEmailParams,
): Promise<void> {
  const { html, text } = buildLoginCodeBody(params.code, params.expiresInMinutes);

  await deliver({
    to: params.to,
    subject: "Your login code — MEDCARE PRO",
    html,
    text,
  });
}

export interface SendPasswordResetEmailParams {
  to: string;
  /** Absolute link to /reset-password carrying the raw token. */
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * "Forgot password?" — the reset link.
 *
 * A CLICKABLE LINK IS CORRECT HERE, where it is not for a login code. The link
 * does not sign anyone in: it opens a form that still demands a new password be
 * chosen and typed twice. Possession of the inbox therefore authorises a
 * password CHANGE, which the account holder sees evidence of, rather than
 * silently handing over a live session the way a magic link would.
 *
 * The token is in the URL and nowhere else — not in the subject, which syncs to
 * lock screens, and not in the body text separately from the link.
 */
function buildPasswordResetBody(
  resetUrl: string,
  expiresInMinutes: number,
): { html: string; text: string } {
  const safeUrl = escapeHtml(resetUrl);

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
      <p style="margin:0 0 16px">
        Someone asked to reset the MEDCARE PRO password for this address. Choose
        a new one here:
      </p>
      <p style="margin:0 0 24px">
        <a href="${safeUrl}"
           style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">
          Choose a new password
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">
        Or paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all">${safeUrl}</p>
      <p style="margin:0;font-size:13px;color:#555">
        The link expires in ${expiresInMinutes} minutes and works once. If you did
        not ask for this, ignore this email — your password has not changed, and
        nobody can use the link without opening it.
      </p>
    </div>
  `.trim();

  // Plain-text alternative uses the raw URL: escaping would corrupt it here.
  const text = [
    "Someone asked to reset the MEDCARE PRO password for this address.",
    "",
    "Choose a new password:",
    resetUrl,
    "",
    `The link expires in ${expiresInMinutes} minutes and works once.`,
    "If you did not ask for this, ignore this email — your password has not changed.",
  ].join("\n");

  return { html, text };
}

/**
 * Sends the reset link. Injected into src/lib/passwordReset.ts as its mailer,
 * on the same pattern as sendLoginCodeEmail — so tests and scripts substitute a
 * capture function and never send real mail.
 */
export async function sendPasswordResetEmail(
  params: SendPasswordResetEmailParams,
): Promise<void> {
  const { html, text } = buildPasswordResetBody(
    params.resetUrl,
    params.expiresInMinutes,
  );

  await deliver({
    to: params.to,
    subject: "Reset your password — MEDCARE PRO",
    html,
    text,
  });
}
