import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";

/**
 * Catalogue features this version knows about but this database lacks.
 *
 * A feature missing from the `features` table fails CLOSED: its module is
 * hidden and refused (see featureResolution). That stays exactly as it is. This
 * module only makes the gap VISIBLE to the people who can read the Features
 * screen, with the command an administrator runs to install it. It never
 * inserts a feature or changes access; it is pure so it can be unit-tested.
 */

/** The setup script that installs each feature on an existing database. */
export const FEATURE_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  billing: "npm run billing:backfill",
  prescriptions: "npm run prescriptions:backfill",
  clinical_ai: "npm run clinical-ai:backfill",
  patient_portal: "npm run patient-portal:backfill",
  appointments: "npm run ap1:backfill",
  ivr: "npm run ivr:backfill",
  tasks: "npm run tasks:backfill",
};

/** Features with no dedicated script are installed by the base seed. */
export const SEED_COMMAND = "npm run prisma:seed";

/**
 * Which feature gates each Roles & Permissions group, for the display-only
 * "not installed" note. Groups not listed (dashboard, roles and settings,
 * features, activity log, patients) have no single installable module.
 */
export const PERMISSION_GROUP_FEATURES: Readonly<Record<string, string>> = {
  Billing: "billing",
  Prescriptions: "prescriptions",
  "Clinical AI": "clinical_ai",
  "Patient portal": "patient_portal",
  Appointments: "appointments",
  Tasks: "tasks",
  Clinics: "clinics",
  Doctors: "doctors",
  Registrations: "registrations",
  Reports: "reports",
  Notifications: "notifications",
  Messages: "whatsapp",
  Team: "team",
  Marketing: "marketing",
};

export interface MissingCatalogueFeature {
  key: string;
  name: string;
  /** The script to run, or null when the base seed installs it. */
  command: string | null;
  message: string;
}

export function missingCatalogueFeatures(installedKeys: Iterable<string>): MissingCatalogueFeature[] {
  const installed = new Set(installedKeys);
  return DEFAULT_FEATURES.filter((feature) => !installed.has(feature.key)).map((feature) => {
    const command = FEATURE_INSTALL_COMMANDS[feature.key] ?? null;
    const action = command ? `An administrator must run: ${command}` : `An administrator must run the seed: ${SEED_COMMAND}`;
    return { key: feature.key, name: feature.name, command,
      message: `${feature.name} is available in this version but not installed on this database. ${action}` };
  });
}

/** Roles & Permissions group names whose module feature is missing from this database. */
export function uninstalledPermissionModules(missing: readonly Pick<MissingCatalogueFeature, "key">[]): string[] {
  const keys = new Set(missing.map((feature) => feature.key));
  return Object.entries(PERMISSION_GROUP_FEATURES).filter(([, key]) => keys.has(key)).map(([module]) => module);
}
