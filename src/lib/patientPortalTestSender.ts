import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
import type { PatientPortalVerificationSender } from "@/lib/patientPortalSender";

/** Test artifacts live outside HTTP and require an explicitly launched local dev
 * process AND a dedicated disposable DB. Production rejects even copied flags.
 */
export function createPatientPortalTestSender(): PatientPortalVerificationSender {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  const directory = process.env.PATIENT_PORTAL_TEST_OUTBOX;
  if (
    process.env.NODE_ENV === "production" ||
    process.env.PATIENT_PORTAL_TEST_TRANSPORT !== "local-file" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.startsWith("/medcare_ep_portal_") ||
    !directory
  )
    throw new PatientPortalError(503);
  async function write(input: unknown) {
    await mkdir(resolve(directory!), { recursive: true });
    await appendFile(
      resolve(directory!, "outbox.jsonl"),
      JSON.stringify(input) + "\n",
      { mode: 0o600 },
    );
  }
  return {
    sendActivation: (input) => write({ type: "activation", ...input }),
    sendLoginCode: (input) => write({ type: "code", ...input }),
  };
}
