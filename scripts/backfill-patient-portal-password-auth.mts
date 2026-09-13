/** Legacy authentication retirement. Dry-run by default. No clinical writes. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
export function assertPortalBackfillTarget(
  url: string,
  apply: boolean,
  allowRemote: boolean,
) {
  const db = new URL(url);
  if (db.pathname === "/u292106402_medcare")
    throw new Error(
      "Production database is forbidden during this implementation.",
    );
  if (
    apply &&
    !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) &&
    !allowRemote
  )
    throw new Error("Remote writes require explicit --apply --allow-remote.");
}
export async function backfillPortalPasswordAuth(apply = false) {
  const now = new Date();
  return prisma.$transaction(async (db) => {
    const report = {
      legacyAccounts: await db.patientPortalAccount.count({
        where: { mobileE164: { not: null } },
      }),
      accountsWithoutPassword: await db.patientPortalAccount.count({
        where: { passwordHash: null },
      }),
      activeSmsActivations: await db.patientPortalActivation.count({
        where: {
          purpose: "LEGACY_SMS",
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      }),
      unconsumedOtpChallenges: await db.patientPortalChallenge.count({
        where: { consumedAt: null },
      }),
      revokedActivations: 0,
      invalidatedChallenges: 0,
    };
    if (apply) {
      report.revokedActivations = (
        await db.patientPortalActivation.updateMany({
          where: { purpose: "LEGACY_SMS", consumedAt: null, revokedAt: null },
          data: { revokedAt: now, activePatientId: null },
        })
      ).count;
      report.invalidatedChallenges = (
        await db.patientPortalChallenge.updateMany({
          where: { consumedAt: null },
          data: { consumedAt: now },
        })
      ).count;
    }
    return report;
  });
}
assertPortalBackfillTarget(
  process.env.DATABASE_URL ?? "mysql://invalid",
  process.argv.includes("--apply"),
  process.argv.includes("--allow-remote"),
);
backfillPortalPasswordAuth(process.argv.includes("--apply"))
  .then((report) =>
    console.log(
      JSON.stringify({
        mode: process.argv.includes("--apply") ? "APPLY" : "DRY_RUN",
        ...report,
      }),
    ),
  )
  .catch(() => {
    console.error(
      "Patient Portal backfill failed; sensitive details withheld.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
