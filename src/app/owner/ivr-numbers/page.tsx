import PlatformPlivoNumbers from "@/components/owner/PlatformPlivoNumbers";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { listPlatformPlivoNumbers } from "@/lib/platform/plivoNumbers";

export default async function OwnerIvrNumbersPage() {
  const owner = await requireOwnerPage();
  const inventory = await listPlatformPlivoNumbers(owner);
  return (
    <div className="w-full space-y-6 px-4 py-7 text-white sm:px-6 md:px-8 lg:px-10">
      <PlatformPlivoNumbers initialInventory={inventory} />
    </div>
  );
}
