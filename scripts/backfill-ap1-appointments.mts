/**
 * AP-1 backfill — registers the appointments feature and gives existing seeded
 * roles their new appointment permissions.
 *
 *     npm run ap1:backfill            # report only, writes nothing
 *     npm run ap1:backfill -- --apply # actually writes
 *
 * A new catalogue entry and a new permission key reach a NEW organisation
 * automatically, because signup runs `seedFeatureCatalogue` and
 * `seedDefaultRoles`. They reach an EXISTING one not at all — so without this
 * script, every organisation created before AP-1 would find Appointments absent
 * from the plan and absent from every role, with no indication why.
 *
 * THE ONE RULE, INHERITED FROM THE STAGE 1 AND STAGE 11 BACKFILLS: a seeded
 * role is topped up only when its permission set is EXACTLY what that role held
 * before AP-1, meaning nobody has edited it. One key added or removed by the
 * organisation and the role is theirs, not ours — skipped and left byte-for-byte
 * alone. An administrator who deliberately narrowed their Receptionist must not
 * find this script quietly handing it seven new abilities.
 *
 * AP-1 goes further than the earlier backfills in one respect: it checks that
 * rule for RECEPTIONIST and DOCTOR too, not only for Admin. Those two gain
 * permissions here, so they need the same proof of being untouched, which is
 * what PRE_APPOINTMENTS_ROLE_PERMISSIONS in lib/defaultRoles.ts is for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It writes NO RoleFeatureAccess row. `appointments` is a PREMIUM feature,
 *     so an absent row DENIES, and that is the point: entitling the
 *     organisation must not expose the module to every role at once. A Clinic
 *     Admin decides who gets it, under Settings -> Features. Expect the module
 *     to be invisible until they do — that is the design, not a failure here.
 *   - It creates no Appointment and no AppointmentType. There is no appointment
 *     data to migrate; an empty table is the correct starting state.
 *   - It touches no Patient, Registration, Doctor, DoctorAvailability or
 *     DoctorLeave row, and does not populate registrations.appointment_id.
 *   - It never rewrites Feature.globalEnabled, and never re-links a PlanFeature
 *     an Owner removed. `seedFeatureCatalogue` is create-only for exactly that
 *     reason.
 *   - It never modifies a custom role, a Staff role, or an Owner role.
 *
 * ORDER MATTERS. Run stage1:backfill and stage11:backfill first. A role still
 * on an earlier catalogue is reported here and skipped, because appending
 * appointment keys to it would leave it in a state no seed ever produced.
 *
 * Dry by default. Refuses to run unless DATABASE_URL points at localhost.
 */
import { prisma } from "@/lib/prisma";
import {
  APPOINTMENT_ROLE_TOP_UPS,
  PRE_APPOINTMENTS_ROLE_PERMISSIONS,
  ROLE_KEYS,
  isUntouchedPreAppointmentsRole,
  type RoleKey,
} from "@/lib/defaultRoles";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import {
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

const APPOINTMENTS_FEATURE = "appointments";

/** The roles this backfill will consider. Staff and Owner are absent by design. */
const TOP_UP_KEYS: readonly RoleKey[] = [
  ROLE_KEYS.CLINIC_ADMIN,
  ROLE_KEYS.RECEPTIONIST,
  ROLE_KEYS.DOCTOR,
];

interface Outcome {
  toppedUp: string[];
  alreadyDone: string[];
  customised: string[];
  /**
   * Roles skipped because they are still on an EARLIER catalogue, not because
   * anyone customised them.
   *
   * Counted separately because the follow-up is completely different: these are
   * one command away from being eligible, whereas a customised role needs a
   * human decision. Lumping them together would send an operator to Settings ->
   * Roles to hand-edit dozens of roles that `stage11:backfill` would fix in one
   * go. The Stage 11 backfill draws the same distinction for the same reason.
   */
  behindEarlierStage: string[];
}

async function backfillFeature(): Promise<void> {
  console.log("Feature catalogue");

  const before = await prisma.feature.findUnique({
    where: { key: APPOINTMENTS_FEATURE },
    select: { id: true, tier: true, globalEnabled: true },
  });

  if (before) {
    console.log(
      `  SKIP  feature '${APPOINTMENTS_FEATURE}' already exists (tier ${before.tier}, globalEnabled ${before.globalEnabled}) — left exactly as it is`,
    );
  } else if (!APPLY) {
    console.log(`  WOULD create feature '${APPOINTMENTS_FEATURE}' (PREMIUM)`);
  }

  if (APPLY) {
    // Create-only and idempotent. Safe to call whether or not the row exists,
    // and it will not rewrite an Owner's kill switch or reinstate a PlanFeature
    // they removed.
    const result = await seedFeatureCatalogue(prisma);
    for (const key of result.createdFeatures) {
      console.log(`  DONE  created feature '${key}'`);
    }
    for (const key of result.linkedFeatures) {
      console.log(`  DONE  linked '${key}' to the '${DEFAULT_PLAN_KEY}' plan`);
    }
    if (
      result.createdFeatures.length === 0 &&
      result.linkedFeatures.length === 0
    ) {
      console.log("  DONE  nothing to create — catalogue already current");
    }
  } else {
    const plan = await prisma.plan.findUnique({
      where: { key: DEFAULT_PLAN_KEY },
      select: { id: true },
    });
    const linked =
      plan && before
        ? await prisma.planFeature.findUnique({
            where: {
              planId_featureId: { planId: plan.id, featureId: before.id },
            },
            select: { enabled: true },
          })
        : null;
    if (!linked) {
      console.log(
        `  WOULD link '${APPOINTMENTS_FEATURE}' to the '${DEFAULT_PLAN_KEY}' plan`,
      );
    } else {
      console.log(
        `  SKIP  already linked to the '${DEFAULT_PLAN_KEY}' plan — left as it is`,
      );
    }
  }
}

async function backfillRoles(): Promise<Outcome> {
  console.log("\nSeeded roles");

  const roles = await prisma.role.findMany({
    where: {
      key: { in: [...TOP_UP_KEYS] },
      tenant: { isPlatform: false },
    },
    select: {
      id: true,
      key: true,
      name: true,
      permissions: true,
      isSystem: true,
      tenant: { select: { businessName: true } },
    },
    orderBy: { id: "asc" },
  });

  const outcome: Outcome = {
    toppedUp: [],
    alreadyDone: [],
    customised: [],
    behindEarlierStage: [],
  };

  for (const role of roles) {
    const key = role.key as RoleKey;
    const current = [...toPermissionList(role.permissions)];
    const label = `${role.tenant.businessName} / ${role.name} (${key})`;

    const additions = APPOINTMENT_ROLE_TOP_UPS[key] ?? [];
    const missing = additions.filter(
      (permission) => !current.includes(permission),
    );

    if (missing.length === 0) {
      outcome.alreadyDone.push(label);
      continue;
    }

    // Two independent conditions, both required. `isSystem` alone is not
    // enough: a tenant can edit a seeded role's permissions through the roles
    // editor without the flag changing.
    if (!role.isSystem || !isUntouchedPreAppointmentsRole(key, current)) {
      // Three reasons a role lands here, needing THREE different follow-ups, so
      // they are reported separately rather than as one "skipped" total. Only
      // the Admin role has earlier snapshots to compare against — Receptionist
      // and Doctor were unchanged by Stage 1 and Stage 11, so a mismatch there
      // can only mean the organisation edited it.
      if (!role.isSystem) {
        outcome.customised.push(label);
        console.log(`  SKIP  ${label} — not a system role, left exactly as it is`);
      } else if (
        key === ROLE_KEYS.CLINIC_ADMIN &&
        isUntouchedPreStage11AdminSet(current)
      ) {
        outcome.behindEarlierStage.push(label);
        console.log(
          `  SKIP  ${label} — still on the pre-Stage-11 catalogue; run stage11:backfill first`,
        );
      } else if (
        key === ROLE_KEYS.CLINIC_ADMIN &&
        isUntouchedHistoricalAdminSet(current)
      ) {
        outcome.behindEarlierStage.push(label);
        console.log(
          `  SKIP  ${label} — still on the pre-Stage-1 catalogue; run stage1:backfill, then stage11:backfill`,
        );
      } else {
        outcome.customised.push(label);
        console.log(
          `  SKIP  ${label} — customised (${current.length} permissions, expected ${PRE_APPOINTMENTS_ROLE_PERMISSIONS[key].length}), left exactly as it is`,
        );
      }
      continue;
    }

    if (APPLY) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: [...current, ...missing] },
      });
    }
    outcome.toppedUp.push(label);
    console.log(
      `  ${APPLY ? "DONE" : "WOULD"}  ${label} — +${missing.join(", ")}`,
    );
  }

  return outcome;
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "AP-1 appointments backfill — APPLYING\n"
      : "AP-1 appointments backfill — dry run (pass --apply to write)\n",
  );

  await backfillFeature();
  const outcome = await backfillRoles();

  const tenants = await prisma.tenant.count({ where: { isPlatform: false } });

  console.log(
    [
      "",
      `Customer organisations: ${tenants}`,
      `Seeded roles examined:     ${outcome.toppedUp.length + outcome.alreadyDone.length + outcome.customised.length + outcome.behindEarlierStage.length}`,
      `  topped up:               ${outcome.toppedUp.length}`,
      `  already had them:        ${outcome.alreadyDone.length}`,
      `  customised, skipped:     ${outcome.customised.length}`,
      `  behind an earlier stage: ${outcome.behindEarlierStage.length}`,
      "",
      "No RoleFeatureAccess rows were written, on purpose: appointments is a",
      "PREMIUM feature, so it stays invisible until a Clinic Admin enables it",
      "per role under Settings -> Features. That is the design, not a gap here.",
      "",
      outcome.behindEarlierStage.length > 0
        ? "Roles behind an earlier stage were NOT changed and need no hand-editing. Run stage1:backfill and stage11:backfill first, then re-run this one."
        : "",
      outcome.customised.length > 0
        ? "Customised roles were NOT changed. Grant the appointment permissions by hand from Settings -> Roles if those organisations should have them."
        : "",
      !APPLY ? "Nothing was written. Re-run with --apply." : "",
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
