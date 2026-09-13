/** Legacy authentication retirement. Dry-run by default. No clinical writes. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
export {
  PRODUCTION_DB_NAME,
  type PortalBackfillGuardOptions,
  parseDatabaseName,
  assertPortalBackfillTarget,
} from "@/lib/patientPortalBackfillGuard";
import { assertPortalBackfillTarget } from "@/lib/patientPortalBackfillGuard";
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
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowRemote = args.includes("--allow-remote");
const allowProduction = args.includes("--allow-production");
const confirmArg = args.find((a) => a.startsWith("--confirm-production-db="));
const confirmProductionDb = confirmArg
  ? confirmArg.slice("--confirm-production-db=".length)
  : undefined;

assertPortalBackfillTarget(
  process.env.DATABASE_URL ?? "mysql://invalid",
  {
    apply,
    allowRemote,
    allowProduction,
    confirmProductionDb,
  },
);
backfillPortalPasswordAuth(apply)
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
