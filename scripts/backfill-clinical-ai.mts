/** Create-only feature installation; no plan grants or role migration. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
const apply = process.argv.includes("--apply");
const local = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(process.env.DATABASE_URL ?? "mysql://invalid").hostname,
);
if (apply && !local && !process.argv.includes("--allow-remote"))
  throw new Error(
    "Remote writes require reviewed approval and --apply --allow-remote.",
  );
async function main() {
  const definition = DEFAULT_FEATURES.find((f) => f.key === "clinical_ai")!;
  const existing = await prisma.feature.findUnique({
    where: { key: definition.key },
    select: { id: true, tier: true, globalEnabled: true },
  });
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${existing ? `KEEP clinical_ai (${existing.tier}, globalEnabled=${existing.globalEnabled})` : "CREATE clinical_ai (PREMIUM, globally disabled)"}. No plan links, roles or overrides changed.`,
  );
  if (apply)
    await prisma.feature.upsert({
      where: { key: definition.key },
      update: {},
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        tier: definition.tier,
        globalEnabled: false,
      },
    });
}
main()
  .catch(() => {
    console.error("Clinical AI feature installation failed; payload withheld.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
