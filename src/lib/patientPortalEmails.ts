import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
export type PortalSecurityMail = {
  to: string;
  purpose: "VERIFY_RECOVERY_EMAIL" | "PASSWORD_RESET";
  url: string;
};
export type PortalMailer = (mail: PortalSecurityMail) => Promise<void>;
export function portalEmailBody(mail: PortalSecurityMail) {
  const verify = mail.purpose === "VERIFY_RECOVERY_EMAIL";
  const title = verify
    ? "Verify your Patient Portal recovery email"
    : "Reset your Patient Portal password";
  const text = `${title}\n\n${verify ? "Verify this address so it can be used to recover your MEDCARE PRO Patient Portal account." : "Choose a new password for your MEDCARE PRO Patient Portal account."}\n${mail.url}\n\nThis link expires in ${verify ? "24 hours" : "15 minutes"} and works once. If you did not request this, ignore this email. Share this security link only with the account holder.`;
  return {
    to: mail.to,
    subject: `${title} — MEDCARE PRO`,
    text,
    html: `<h1>${title}</h1><p>${verify ? "Confirm this recovery address." : "Choose a new password."}</p><p><a href="${escapeHtml(mail.url)}">${verify ? "Verify recovery email" : "Reset password"}</a></p><p>Expires in ${verify ? "24 hours" : "15 minutes"}. Works once. If you did not request this, ignore this email.</p>`,
  };
}
export function createPatientPortalTestMailer(): PortalMailer {
  const db = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  const directory = process.env.PATIENT_PORTAL_TEST_OUTBOX;
  if (
    process.env.NODE_ENV === "production" ||
    process.env.PATIENT_PORTAL_TEST_TRANSPORT !== "local-file" ||
    !["localhost", "127.0.0.1"].includes(db.hostname) ||
    !db.pathname.startsWith("/medcare_ep_portal_") ||
    !directory
  )
    throw new PatientPortalError(503);
  return async (mail) => {
    const { mkdir, appendFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    await mkdir(resolve(directory), { recursive: true });
    await appendFile(
      resolve(directory, "outbox.jsonl"),
      JSON.stringify(mail) + "\n",
      { mode: 0o600 },
    );
  };
}
export const sendPatientPortalSecurityEmail: PortalMailer = async (mail) => {
  if (process.env.PATIENT_PORTAL_TEST_TRANSPORT)
    return createPatientPortalTestMailer()(mail);
  await sendTransactionalEmail(portalEmailBody(mail));
};
