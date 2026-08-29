import {
  ADMIN_DASHBOARD_ACTION_PERMISSIONS,
  ADMIN_DASHBOARD_DATA_PERMISSIONS,
  clinicIdsForDashboardScope,
  resolveAdminDashboardClinicAccess,
} from "@/lib/adminDashboardScope";
import { DEFAULT_ROLES, ROLE_KEYS } from "@/lib/defaultRoles";
import {
  ALL_PERMISSIONS,
  DASHBOARD_DATA_PERMISSIONS,
  WILDCARD,
} from "@/lib/permissions";
import type { ClinicScope } from "@/lib/rbac";

let failures = 0;
function check(label: string, condition: boolean): void {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures += 1;
}

const clinics = [
  { id: "clinic-a", name: "Clinic A" },
  { id: "clinic-b", name: "Clinic B" },
];

console.log("\nDashboard catalogue");
check(
  "every dashboard scope key is registered",
  ADMIN_DASHBOARD_DATA_PERMISSIONS.every((permission) =>
    ALL_PERMISSIONS.includes(permission),
  ),
);
check(
  "catalogue and dashboard scope resolver agree",
  DASHBOARD_DATA_PERMISSIONS.length === ADMIN_DASHBOARD_DATA_PERMISSIONS.length &&
    DASHBOARD_DATA_PERMISSIONS.every((permission) =>
      ADMIN_DASHBOARD_DATA_PERMISSIONS.includes(permission),
    ),
);
check(
  "action permissions remain outside the dashboard namespace",
  ADMIN_DASHBOARD_ACTION_PERMISSIONS.every(
    (permission) => !permission.startsWith("dashboard:"),
  ),
);

console.log("\nDefault roles");
const role = (key: (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS]) =>
  DEFAULT_ROLES.find((item) => item.key === key)!;
check(
  "wildcard owner retains every dashboard capability",
  role(ROLE_KEYS.OWNER).permissions.length === 1 &&
    role(ROLE_KEYS.OWNER).permissions[0] === WILDCARD,
);
check(
  "clinic admin references every known dashboard permission",
  DASHBOARD_DATA_PERMISSIONS.every((permission) =>
    role(ROLE_KEYS.CLINIC_ADMIN).permissions.includes(permission),
  ),
);
check(
  "doctor has no default revenue dashboard access",
  !role(ROLE_KEYS.DOCTOR).permissions.includes("dashboard:revenue:view"),
);
check(
  "receptionist has no default revenue or team dashboard access",
  !role(ROLE_KEYS.RECEPTIONIST).permissions.includes("dashboard:revenue:view") &&
    !role(ROLE_KEYS.RECEPTIONIST).permissions.includes("dashboard:team:view"),
);

console.log("\nScope narrowing");
check(
  "a permitted clinic selection narrows access",
  clinicIdsForDashboardScope(
    { scope: "all" },
    clinics,
    "clinic-a",
  ).join(",") === "clinic-a",
);
check(
  "an unauthorized clinic selection returns no data",
  clinicIdsForDashboardScope(
    { scope: "clinics", clinicIds: ["clinic-a"] },
    clinics,
    "clinic-b",
  ).length === 0,
);

const scopes = new Map<string, ClinicScope>([
  ["dashboard:view", { scope: "all" }],
  ["dashboard:appointments:view", { scope: "all" }],
  ["appointment:create", { scope: "clinics", clinicIds: ["clinic-a"] }],
]);
const access = resolveAdminDashboardClinicAccess(scopes, clinics, null);
check(
  "dashboard analytics do not grant create authority",
  access.dashboard["dashboard:appointments:view"].length === 2 &&
    access.actions["appointment:create"].length === 1,
);
check(
  "missing revenue permission produces an empty revenue scope",
  access.dashboard["dashboard:revenue:view"].length === 0,
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
