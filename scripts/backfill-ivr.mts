/**
 * Installs the IVR feature entitlement in the catalogue and default Standard plan.
 * Create-only and idempotent. Dry-run by default; pass --apply to write.
 */
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "IVR backfill — APPLYING\n"
      : "IVR backfill — dry run (pass --apply to write)\n",
  );

  if (APPLY) {
    const result = await seedFeatureCatalogue(prisma);
    console.log(
      `  Feature catalogue: ${result.createdFeatures.length} created (${result.createdFeatures.join(", ") || "none"}), ` +
        `${result.linkedFeatures.length} linked (${result.linkedFeatures.join(", ") || "none"})`,
    );
  } else {
    console.log("  WOULD create/link the IVR CORE feature where missing");
    console.log("\nNothing was written. Re-run with --apply.");
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
