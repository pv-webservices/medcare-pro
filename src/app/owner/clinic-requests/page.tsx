import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ClinicRequestsManager from "@/components/owner/ClinicRequestsManager";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import {
  getClinicCapacityInventory,
  listClinicCapacityRequests,
  ownerClinicRequestFilterSchema,
} from "@/lib/platform/clinicCapacity";

export default async function OwnerClinicRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const owner = await requireOwnerPage();
  const params = await searchParams;
  const filters = ownerClinicRequestFilterSchema.parse({
    status: typeof params.status === "string" ? params.status : "ALL",
    search: typeof params.search === "string" ? params.search : undefined,
  });
  const [requests, inventory] = await Promise.all([
    listClinicCapacityRequests(owner, filters),
    getClinicCapacityInventory(owner),
  ]);
  const statuses = ["PENDING", "PAYMENT_PENDING", "PAYMENT_SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "ALL"] as const;

  return <div className="w-full space-y-6 px-4 py-7 text-white sm:px-6 md:px-8 lg:px-10">
    <div><Link href="/owner/dashboard" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5"/>Platform overview</Link><h1 className="mt-3 text-2xl font-bold sm:text-3xl">Clinic requests</h1><p className="mt-1.5 max-w-3xl text-sm text-slate-400">Review commercial requests, confirm payment, approve plan-aware capacity, and manage auditable grants. Approval never creates a clinic.</p></div>
    <form className="flex flex-col gap-3 sm:flex-row"><input type="hidden" name="status" value={filters.status ?? "ALL"}/><input aria-label="Search organizations" name="search" defaultValue={filters.search ?? ""} placeholder="Search organization name or email" className="min-h-11 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"/><button className="rounded-xl border border-slate-700 bg-slate-800 px-4 text-sm font-semibold">Search</button></form>
    <div className="flex flex-wrap gap-2">{statuses.map((status) => <Link key={status} href={`/owner/clinic-requests?status=${status}${filters.search ? `&search=${encodeURIComponent(filters.search)}` : ""}`} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filters.status === status || (!filters.status && status === "PENDING") ? "border-indigo-500 bg-indigo-950 text-indigo-300" : "border-slate-700 text-slate-400"}`}>{status === "ALL" ? "All" : status.toLowerCase().replaceAll("_", " ")}</Link>)}</div>
    <ClinicRequestsManager
      requests={requests.map((request) => ({
        id: request.id,
        requestType: request.requestType,
        requestedQuantity: request.requestedQuantity,
        status: request.status,
        paymentStatus: request.paymentStatus,
        createdAt: request.createdAt.toISOString(),
        tenant: request.tenant,
        requestedPlan: request.requestedPlan,
        capacity: {
          usedClinics: request.capacity.usedClinics,
          effectiveLimit: request.capacity.effectiveLimit,
        },
      }))}
      inventory={inventory}
    />
  </div>;
}
