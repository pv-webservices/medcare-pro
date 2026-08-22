/**
 * Stage 11 backfill — gives existing Admin roles the new `audit:read` key.
 *
 *     npm run stage11:backfill            # report only, writes nothing
 *     npm run stage11:backfill -- --apply # actually writes
 *
 * A new catalogue key reaches a NEW organisation automatically, because
 * `seedDefaultRoles` copies ALL_PERMISSIONS at signup. It reaches an EXISTING
 * one not at all — so without this script every organisation created before
 * Stage 11 would have an Admin who cannot open the activity log, with no
 * indication why.
 *
 * THE ONE RULE, INHERITED FROM THE STAGE 1 BACKFILL: a seeded Admin role is
 * topped up only when its permission set is EXACTLY the pre-Stage-11 catalogue,
 * meaning nobody has edited it. One key added or removed by the organisation and
 * the role is theirs, not ours — it is skipped and left byte-for-byte alone. An
 * administrator who deliberately took a permission off their Admin role must not
 * find this script quietly handing it something new.
 *
 * Owner needs nothing: it holds the wildcard, so new catalogue entries reach it
 * on their own.
 *
 * Dry by default. Refuses to run unless DATABASE_URL points at localhost.
 */
import { prisma } from "@/lib/prisma";
import {
  STAGE_11_PERMISSIONS,
  isUntouchedHistoricalAdminSet,
  isUntouchedPreStage11AdminSet,
} from "@/lib/permissions";
// The canonical parser: a malformed `permissions` column grants nothing rather
// than being coerced, which matters more here than anywhere — this script
// decides what to append to it.
import { toPermissionList } from "@/lib/rbac";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

interface Outcome {
  toppedUp: string[];
  alreadyDone: string[];
  customised: string[];
  preStage1: string[];
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Stage 11 backfill — APPLYING\n"
      : "Stage 11 backfill — dry run (pass --apply to write)\n",
  );

  const admins = await prisma.role.findMany({
    where: { key: "CLINIC_ADMIN", tenant: { isPlatform: false } },
    select: {
      id: true,
      name: true,
      permissions: true,
      tenant: { select: { businessName: true } },
    },
  });

  const outcome: Outcome = {
    toppedUp: [],
    alreadyDone: [],
    customised: [],
    preStage1: [],
  };

  for (const admin of admins) {
    const current = [...toPermissionList(admin.permissions)];
    const label = `${admin.tenant.businessName} / ${admin.name} (${admin.id})`;

    const missing = STAGE_11_PERMISSIONS.filter(
      (permission) => !current.includes(permission),
    );

    if (missing.length === 0) {
      outcome.alreadyDone.push(label);
      continue;
    }

    if (!isUntouchedPreStage11AdminSet(current)) {
      // Two reasons a role can land here, and they need DIFFERENT follow-up, so
      // they are counted separately rather than lumped into one "skipped" total.
      //
      // The test is the real predicate, not a size heuristic: an Admin holding
      // some other number of keys is a customised role that the Stage 1 backfill
      // would skip too, and telling its operator to run that script would send
      // them somewhere that does nothing.
      if (isUntouchedHistoricalAdminSet(current)) {
        outcome.preStage1.push(label);
        console.log(
          `  SKIP  ${label} — still on the pre-Stage-1 catalogue; run stage1:backfill first`,
        );
      } else {
        outcome.customised.push(label);
        console.log(
          `  SKIP  ${label} — customised (${current.length} permissions), left exactly as it is`,
        );
      }
      continue;
    }

    if (APPLY) {
      await prisma.role.update({
        where: { id: admin.id },
        data: { permissions: [...current, ...missing] },
      });
    }
    outcome.toppedUp.push(label);
    console.log(
      `  ${APPLY ? "DONE" : "WOULD"}  ${label} — +${missing.join(", ")}`,
    );
  }

  console.log(
    [
      "",
      `Admin roles examined: ${admins.length}`,
      `  topped up:           ${outcome.toppedUp.length}`,
      `  already had it:      ${outcome.alreadyDone.length}`,
      `  customised, skipped: ${outcome.customised.length}`,
      `  on pre-Stage-1 set:  ${outcome.preStage1.length}`,
      "",
      outcome.customised.length > 0
        ? "Customised roles were NOT changed. Grant audit:read by hand from Settings → Roles if those organisations should have the activity log."
        : "",
      !APPLY && outcome.toppedUp.length > 0
        ? "Nothing was written. Re-run with --apply."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error("\nScript error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
