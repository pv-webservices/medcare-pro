/** Complete empty + Phase 1 upgrade replay in NEW disposable local databases.
 * Uses existing reachable local MariaDB. Requires a dedicated local test URL.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertPatientPortalTestDatabase } from "./patient-portal-test-fixture";
import { prisma } from "@/lib/prisma";
assertPatientPortalTestDatabase();
const source = new URL(process.env.DATABASE_URL!);
const folder = resolve(tmpdir(), `medcare-portal-migration-${Date.now()}`);
mkdirSync(folder);
const migration = "20260913020000_patient_portal_password_email_auth";
const root = process.cwd();
const schema = execFileSync(
  "git",
  ["show", "a2b4e607cd79f7037525be48d51a37eb32e7f905:prisma/schema.prisma"],
  { encoding: "utf8" },
);
writeFileSync(resolve(folder, "baseline.prisma"), schema);
mkdirSync(resolve(folder, "migrations"));
for (const entry of readdirSync(resolve(root, "prisma/migrations"), {
  withFileTypes: true,
}))
  if (entry.isDirectory() && entry.name < migration)
    cpSync(
      resolve(root, "prisma/migrations", entry.name),
      resolve(folder, "migrations", entry.name),
      { recursive: true },
    );
cpSync(
  resolve(root, "prisma/migrations/migration_lock.toml"),
  resolve(folder, "migrations/migration_lock.toml"),
);
const config = resolve(root, "scripts/portal-migration.tmp.config.ts");
writeFileSync(
  config,
  `import {defineConfig} from 'prisma/config'; export default defineConfig({schema:${JSON.stringify(resolve(folder, "baseline.prisma"))},migrations:{path:${JSON.stringify(resolve(folder, "migrations"))}},datasource:{url:process.env.DATABASE_URL!}});`,
);
function deploy(url: string, baseline: boolean) {
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      ...(baseline ? ["--config", config] : []),
    ],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
}
let stage = "create databases";
async function main() {
  const adminUrl = new URL(source);
  adminUrl.pathname = "/mysql";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const stamp = Date.now();
  const emptyName = `medcare_ep_portal_empty_${stamp}`,
    upgradeName = `medcare_ep_portal_upgrade_${stamp}`;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE ${emptyName}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${upgradeName}`);
  } finally {
    await admin.$disconnect();
  }
  const emptyUrl = new URL(source);
  stage = "empty replay";
  emptyUrl.pathname = `/${emptyName}`;
  deploy(emptyUrl.toString(), false);
  console.log("PASS Complete 34-migration chain from empty database");
  const upgradeUrl = new URL(source);
  stage = "baseline replay";
  upgradeUrl.pathname = `/${upgradeName}`;
  deploy(upgradeUrl.toString(), true);
  function phase(mode: string) {
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/patient-portal-migration-fixture.mts",
        mode,
        resolve(folder, "clinical-before.json"),
      ],
      {
        env: { ...process.env, DATABASE_URL: upgradeUrl.toString() },
        stdio: "pipe",
      },
    );
  }
  stage = "baseline fixture";
  phase("--before");
  stage = "upgrade replay";
  deploy(upgradeUrl.toString(), false);
  stage = "preservation checks";
  phase("--after");
  console.log(
    "PASS Phase 1 upgrade preserves clinical data and legacy portal history byte-equivalent",
  );
  console.log(
    "PASS Migration invents no passwords or emails and leaves legacy activation for explicit backfill",
  );
  console.log("Patient Portal migration checks: 3 passed");
}
main()
  .catch((error) => {
    console.error(
      `Local migration test failed at ${stage}: ${error instanceof Error ? error.name : "unknown"} ${(error as { code?: string }).code ?? ""}; payload withheld.`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    const { unlinkSync } = await import("node:fs");
    unlinkSync(config);
  });
