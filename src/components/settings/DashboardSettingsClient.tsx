"use client";

import { useEffect, useState } from "react";
import { BarChart3, LayoutDashboard, ShieldCheck } from "lucide-react";
import DashboardLayoutEditor, { type DashboardWidgetSlot } from "@/components/dashboard/DashboardLayoutEditor";
import { cx } from "@/components/ui";
import { DASHBOARD_WIDGETS, type DashboardLayoutConfig } from "@/lib/dashboardWidgets";
import type { RoleDashboardLayoutResult } from "@/lib/dashboardLayouts";
import type { ApiResponse } from "@/lib/utils";

function previewSlots(layout: DashboardLayoutConfig): DashboardWidgetSlot[] {
  return layout.widgets.map((item) => {
    const widget = DASHBOARD_WIDGETS.get(item.widgetId)!;
    return {
      id: item.widgetId,
      content: (
        <div className="flex min-h-[116px] items-center rounded-2xl border border-line bg-canvas p-4 shadow-card">
          <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink"><BarChart3 className="h-4 w-4" /></span>
          <div className="min-w-0"><p className="text-label font-semibold text-ink">{widget.title}</p><p className="mt-1 text-meta text-muted">{widget.description}</p></div>
        </div>
      ),
    };
  });
}

export default function DashboardSettingsClient({
  personalLayout,
  personalSource,
  canCustomize,
  roles,
}: {
  personalLayout: DashboardLayoutConfig;
  personalSource: string;
  canCustomize: boolean;
  roles: Array<{ id: string; name: string }>;
}) {
  const [tab, setTab] = useState<"personal" | "roles">(canCustomize || roles.length === 0 ? "personal" : "roles");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [roleResult, setRoleResult] = useState<RoleDashboardLayoutResult | null>(null);
  const [loadingRole, setLoadingRole] = useState(!canCustomize && roles.length > 0);
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "roles" || !roleId) return;
    const controller = new AbortController();
    fetch(`/api/dashboard/layout/roles/${encodeURIComponent(roleId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ApiResponse<RoleDashboardLayoutResult>;
        if (!payload.success) throw new Error(payload.error);
        if (!payload.data) throw new Error("That role layout was not returned.");
        setRoleResult(payload.data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRoleError(error instanceof Error ? error.message : "Couldn't load that role default.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRole(false);
      });
    return () => controller.abort();
  }, [roleId, tab]);

  return (
    <div className="space-y-5">
      {canCustomize && roles.length > 0 && (
        <div className="inline-flex rounded-xl border border-line bg-canvas-deep p-1">
          <button type="button" onClick={() => setTab("personal")} className={cx("inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-label font-semibold", tab === "personal" ? "bg-canvas text-accent shadow-card" : "text-muted")}><LayoutDashboard className="h-4 w-4" />My Dashboard</button>
          <button type="button" onClick={() => { setLoadingRole(true); setRoleError(null); setTab("roles"); }} className={cx("inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-label font-semibold", tab === "roles" ? "bg-canvas text-accent shadow-card" : "text-muted")}><ShieldCheck className="h-4 w-4" />Role Defaults</button>
        </div>
      )}

      {tab === "personal" && (
        <DashboardLayoutEditor
          initialLayout={personalLayout}
          widgets={previewSlots(personalLayout)}
          sourceLabel={personalSource}
          canCustomize={canCustomize}
          startInEditMode={canCustomize}
          editorTitle="My dashboard"
        />
      )}

      {tab === "roles" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-canvas p-4 shadow-card">
            <label htmlFor="dashboard-role" className="text-label font-semibold text-ink">Role</label>
            <p className="mt-1 text-meta text-muted">Configure the default inherited by users with this single role and no personal override.</p>
            <select id="dashboard-role" value={roleId} onChange={(event) => { setLoadingRole(true); setRoleError(null); setRoleId(event.target.value); setRoleResult(null); }} className="mt-3 h-10 w-full max-w-sm rounded-xl border border-line bg-canvas px-3 text-body text-ink shadow-field">
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </div>
          {loadingRole && <div className="rounded-2xl border border-line bg-canvas p-8 text-center text-body text-muted">Loading role dashboard…</div>}
          {roleError && <div role="alert" className="rounded-2xl border border-alert-line bg-alert-bg p-4 text-body text-alert-ink">{roleError}</div>}
          {roleResult && !loadingRole && (
            <DashboardLayoutEditor
              key={roleResult.role.id}
              initialLayout={roleResult.layout}
              widgets={previewSlots(roleResult.layout)}
              sourceLabel={roleResult.source === "role" ? `${roleResult.role.name} default` : "system default"}
              endpoint={`/api/dashboard/layout/roles/${encodeURIComponent(roleResult.role.id)}`}
              resetConfirmation={`Restore the system default for ${roleResult.role.name}? Users relying on this role default will see the change. Personal overrides will be kept.`}
              startInEditMode
              editorTitle={`${roleResult.role.name} default`}
            />
          )}
          {roles.length === 0 && <div className="rounded-2xl border border-line bg-canvas p-6 text-body text-muted">There are no lower-authority roles you can configure.</div>}
        </div>
      )}
    </div>
  );
}
