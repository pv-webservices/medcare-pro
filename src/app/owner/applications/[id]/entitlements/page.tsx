import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getTenantEntitlements } from "@/lib/platform/entitlements";
import { ScopeError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import TenantEntitlementsPanel from "@/components/owner/TenantEntitlementsPanel";

interface PageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function OwnerTenantEntitlementsPage({ params }: PageProps) {
  const owner = await requireOwnerPage();
  const { id } = await params;

  let view;
  try {
    view = await getTenantEntitlements(owner, id);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  // Load real clinic registration date and recent audit logs
  const [tenantRow, recentChanges] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id },
      select: { createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: {
        targetType: "Tenant",
        targetId: id,
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  const entitled = view.features.filter((feature) => feature.effective).length;
  const isActive = view.status.toUpperCase() === "ACTIVE";

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6 text-white font-sans">
      {/* Breadcrumb / Back Link */}
      <div>
        <Link
          href={`/owner/applications/${view.tenantId}`}
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to {view.clinicName}</span>
        </Link>

        {/* Page Header */}
        <div className="mt-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {view.clinicName}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {view.planName ? `On the ${view.planName} plan` : "No plan assigned"} &middot;{" "}
            <span className="tabular-nums font-semibold text-slate-200">{entitled}</span> of{" "}
            <span className="tabular-nums font-semibold text-slate-200">{view.features.length}</span> features available to them &middot;{" "}
            <span className={isActive ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
              {view.status.toLowerCase()}
            </span>
          </p>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout & Side Rail */}
      <TenantEntitlementsPanel
        view={view}
        clinicCreatedAt={tenantRow?.createdAt ?? null}
        recentChanges={recentChanges.map((r) => ({
          id: r.id,
          action: r.action,
          reason: r.reason,
          createdAt: r.createdAt,
          actorName: r.actor?.name ?? "Super Admin",
        }))}
      />
    </div>
  );
}
