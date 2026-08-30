"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Building,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  MoreVertical,
  PieChart,
  RotateCcw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Stethoscope,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Menu, { menuItemClasses } from "@/components/ui/Menu";
import Toggle from "@/components/ui/Toggle";
import { cx } from "@/components/ui/cx";
import {
  PERMISSION_GROUPS,
  type PermissionDefinition,
  type PermissionGroup,
} from "@/lib/permissions";
import type { RoleSummary } from "@/lib/roles";
import { getRoleVisual } from "@/components/settings/roleVisuals";

interface EditRolePermissionsProps {
  role: RoleSummary;
  grantablePermissions: readonly string[];
  canManage: boolean;
  onBack: () => void;
  onSaved: () => void;
}

interface ModuleMeta {
  icon: LucideIcon;
  bgColor: string;
  textColor: string;
  description: string;
}

const MODULE_METAS: Record<string, ModuleMeta> = {
  Clinics: {
    icon: Building,
    bgColor: "bg-[#3b82f6]",
    textColor: "text-[#3b82f6]",
    description: "Manage clinics, locations, services and clinic settings.",
  },
  Doctors: {
    icon: Stethoscope,
    bgColor: "bg-[#0ea5e9]",
    textColor: "text-[#0ea5e9]",
    description: "Manage doctors, their profiles, schedules and availability.",
  },
  Patients: {
    icon: Users,
    bgColor: "bg-[#10b981]",
    textColor: "text-[#10b981]",
    description: "Manage patient profiles, demographics and medical history.",
  },
  Registrations: {
    icon: ClipboardList,
    bgColor: "bg-[#22c55e]",
    textColor: "text-[#22c55e]",
    description: "Manage OPD/IPD registrations and check-in/out.",
  },
  Appointments: {
    icon: Calendar,
    bgColor: "bg-[#f59e0b]",
    textColor: "text-[#f59e0b]",
    description: "Manage appointments, reschedules and cancellations.",
  },
  Reports: {
    icon: PieChart,
    bgColor: "bg-[#8b5cf6]",
    textColor: "text-[#8b5cf6]",
    description: "View and export analytics, reports and insights.",
  },
  Notifications: {
    icon: Bell,
    bgColor: "bg-[#6366f1]",
    textColor: "text-[#6366f1]",
    description: "View and clear real-time activity and record-change notifications.",
  },
  Messages: {
    icon: MessageSquare,
    bgColor: "bg-[#06b6d4]",
    textColor: "text-[#06b6d4]",
    description: "Send WhatsApp templates and manage approved patient messaging.",
  },
  "Roles & settings": {
    icon: Settings,
    bgColor: "bg-[#7c3aed]",
    textColor: "text-[#7c3aed]",
    description: "Manage account roles, permissions and clinic branding settings.",
  },
  Team: {
    icon: Users,
    bgColor: "bg-[#ec4899]",
    textColor: "text-[#ec4899]",
    description: "Manage team members, invitations, and membership approvals.",
  },
  Features: {
    icon: Sliders,
    bgColor: "bg-[#f97316]",
    textColor: "text-[#f97316]",
    description: "View entitled features and toggle role-based feature permissions.",
  },
  "Activity log": {
    icon: ShieldCheck,
    bgColor: "bg-[#475569]",
    textColor: "text-[#475569]",
    description: "View immutable organizational audit history and security events.",
  },
  Tasks: {
    icon: CheckSquare,
    bgColor: "bg-[#14b8a6]",
    textColor: "text-[#14b8a6]",
    description: "Create, assign, edit, and track clinic operational tasks.",
  },
  Marketing: {
    icon: Megaphone,
    bgColor: "bg-[#f43f5e]",
    textColor: "text-[#f43f5e]",
    description: "Manage marketing campaigns, broadcasts, and promotion analytics.",
  },
  "Dashboard Data": {
    icon: LayoutGrid,
    bgColor: "bg-[#2563eb]",
    textColor: "text-[#2563eb]",
    description: "Control access to operational dashboard widgets and analytics summaries.",
  },
  "Dashboard Layout": {
    icon: LayoutGrid,
    bgColor: "bg-[#4f46e5]",
    textColor: "text-[#4f46e5]",
    description: "Customize individual dashboard layout and manage role dashboard defaults.",
  },
};

export default function EditRolePermissions({
  role,
  grantablePermissions,
  canManage,
  onBack,
  onSaved,
}: EditRolePermissionsProps) {
  const grantable = useMemo(() => new Set(grantablePermissions), [grantablePermissions]);
  const roleVisual = useMemo(
    () => getRoleVisual(role.name, role.isWildcard),
    [role.name, role.isWildcard],
  );

  // Active state for selected permissions
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    () => new Set(role.permissions),
  );

  // Active sidebar module filter: "ALL" or module name
  const [activeModule, setActiveModule] = useState<string>("ALL");

  // Search query
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Status filter tab: "ALL" | "ENABLED" | "DISABLED"
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ENABLED" | "DISABLED">("ALL");

  // Expanded modules state: map of module name to boolean
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const group of PERMISSION_GROUPS) {
      init[group.module] = true;
    }
    return init;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Calculate live counts
  const totalAllPermissions = useMemo(
    () => PERMISSION_GROUPS.reduce((acc, g) => acc + g.permissions.length, 0),
    [],
  );

  const enabledCount = useMemo(() => {
    if (role.isWildcard) return totalAllPermissions;
    let count = 0;
    for (const group of PERMISSION_GROUPS) {
      for (const perm of group.permissions) {
        if (selectedPermissions.has(perm.key)) count++;
      }
    }
    return count;
  }, [role.isWildcard, selectedPermissions, totalAllPermissions]);

  const disabledCount = totalAllPermissions - enabledCount;

  // Has changes compared to initial role
  const isDirty = useMemo(() => {
    if (role.isWildcard) return false;
    const original = new Set(role.permissions);
    if (original.size !== selectedPermissions.size) return true;
    for (const p of original) {
      if (!selectedPermissions.has(p)) return true;
    }
    return false;
  }, [role.permissions, role.isWildcard, selectedPermissions]);

  // Toggle individual permission
  const handleTogglePermission = (key: string, checked: boolean) => {
    if (role.isWildcard) return;
    if (!grantable.has(key)) return;

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  // Toggle module-level master switch
  const handleToggleModule = (group: PermissionGroup, checked: boolean) => {
    if (role.isWildcard) return;

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      for (const perm of group.permissions) {
        if (grantable.has(perm.key)) {
          if (checked) {
            next.add(perm.key);
          } else {
            next.delete(perm.key);
          }
        }
      }
      return next;
    });
  };

  // Enable all grantable permissions (scoped to current search/module filter or globally)
  const handleEnableAll = () => {
    if (role.isWildcard) return;

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      for (const group of PERMISSION_GROUPS) {
        if (activeModule !== "ALL" && group.module !== activeModule) continue;
        for (const perm of group.permissions) {
          if (grantable.has(perm.key)) {
            next.add(perm.key);
          }
        }
      }
      return next;
    });
  };

  // Disable all grantable permissions
  const handleDisableAll = () => {
    if (role.isWildcard) return;

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      for (const group of PERMISSION_GROUPS) {
        if (activeModule !== "ALL" && group.module !== activeModule) continue;
        for (const perm of group.permissions) {
          if (grantable.has(perm.key)) {
            next.delete(perm.key);
          }
        }
      }
      return next;
    });
  };

  // Toggle expand/collapse of a module card
  const toggleExpandModule = (moduleName: string) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleName]: !prev[moduleName],
    }));
  };

  // Reset changes
  const handleReset = () => {
    setSelectedPermissions(new Set(role.permissions));
    setError(null);
    setSuccessMessage(null);
  };

  // Save permissions via API
  const handleSave = async () => {
    if (role.isWildcard) return;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateRole",
          roleId: role.id,
          permissions: Array.from(selectedPermissions),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Failed to save role permissions. Please try again.");
        setIsSaving(false);
        return;
      }

      setSuccessMessage("Permissions saved successfully.");
      setIsSaving(false);
      onSaved();
    } catch {
      setError("Network error. Could not connect to the server.");
      setIsSaving(false);
    }
  };

  // Filter groups by activeModule, searchQuery, and statusFilter
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const groups: PermissionGroup[] = [];

    for (const group of PERMISSION_GROUPS) {
      // Check module match
      if (activeModule !== "ALL" && group.module !== activeModule) {
        continue;
      }

      // Filter permissions within group
      const matchingPermissions = group.permissions.filter((perm: PermissionDefinition) => {
        // Status filter
        const isEnabled = role.isWildcard || selectedPermissions.has(perm.key);
        if (statusFilter === "ENABLED" && !isEnabled) return false;
        if (statusFilter === "DISABLED" && isEnabled) return false;

        // Search query filter
        if (query) {
          const matchLabel = perm.label.toLowerCase().includes(query);
          const matchDesc = perm.description.toLowerCase().includes(query);
          const matchKey = perm.key.toLowerCase().includes(query);
          const matchModule = group.module.toLowerCase().includes(query);
          if (!matchLabel && !matchDesc && !matchKey && !matchModule) {
            return false;
          }
        }

        return true;
      });

      if (matchingPermissions.length > 0) {
        groups.push({
          module: group.module,
          permissions: matchingPermissions,
        });
      }
    }

    return groups;
  }, [activeModule, searchQuery, statusFilter, role.isWildcard, selectedPermissions]);

  const RoleIcon = roleVisual.icon;

  return (
    <div className="space-y-6 pb-28">
      {/* Breadcrumb & Navigation */}
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-meta text-muted">
          <Link href="/settings" className="hover:text-ink transition-colors">
            Settings
          </Link>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <button
            type="button"
            onClick={onBack}
            className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:underline"
          >
            Roles &amp; permissions
          </button>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <span className="text-ink font-medium">{role.name}</span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-display font-semibold tracking-tight text-ink">
              Edit permissions
            </h1>
            <p className="mt-1 text-body text-muted">
              Manage what the {role.name} role can see and do.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onBack}
            className="hidden sm:inline-flex"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to roles
          </Button>
        </div>
      </div>

      {/* Role Summary Card */}
      <div className="rounded-3xl border border-line bg-canvas p-6 shadow-card transition-shadow">
        <div className="grid gap-6 md:grid-cols-[auto_1fr_auto] md:items-center">
          {/* Left: Role Icon & Title & Stats */}
          <div className="flex items-center gap-4">
            <div
              className={cx(
                "flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl shadow-sm",
                roleVisual.bgColor,
              )}
            >
              <RoleIcon className="h-6 w-6" strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-section font-semibold text-ink">{role.name}</h2>
                {role.isWildcard && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-micro font-semibold uppercase tracking-wider text-amber-800">
                    Wildcard Owner
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-meta text-muted">
                <span className="flex items-center gap-1 font-medium">
                  {role.isWildcard ? "All access" : `${role.permissions.length} permissions`}
                </span>
                <span>•</span>
                <span>
                  {role.assignmentCount === 1
                    ? "1 assignment"
                    : `${role.assignmentCount} assignments`}
                </span>
              </div>
            </div>
          </div>

          {/* Divider on MD+ */}
          <div className="border-t border-line md:border-l md:border-t-0 md:pl-6">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted">
              Role description
            </p>
            <p className="mt-1 text-body text-ink-soft">
              {roleVisual.description}
            </p>
          </div>

          {/* Overflow Menu */}
          <div className="flex justify-end">
            <Menu
              align="end"
              label="Role options"
              trigger={({ isOpen }) => (
                <div
                  className={cx(
                    "flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-canvas-deep hover:text-ink",
                    isOpen && "bg-canvas-deep text-ink",
                  )}
                >
                  <MoreVertical className="h-4 w-4" />
                </div>
              )}
            >
              <button
                type="button"
                onClick={handleReset}
                disabled={!isDirty}
                className={menuItemClasses(false)}
              >
                <RotateCcw className="h-4 w-4 text-muted" />
                Reset changes
              </button>
            </Menu>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-alert-border bg-alert-bg p-4 text-body text-alert-ink"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-body text-emerald-800"
        >
          {successMessage}
        </div>
      )}

      {role.isWildcard && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-body text-amber-900">
          <p className="font-semibold">Account Owner role has permanent wildcard access</p>
          <p className="mt-0.5 text-label text-amber-800">
            This role holds the wildcard permission (<code>*</code>), granting full access to every module and capability across the organisation. Wildcard permissions cannot be toggled off.
          </p>
        </div>
      )}

      {/* Main Split Layout: Left Module Nav + Right Module Cards */}
      <div className="grid gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
        {/* Left Sidebar Modules Navigation */}
        <aside aria-label="Permission modules" className="rounded-3xl border border-line bg-canvas p-3 shadow-card">
          <div className="mb-2 px-3 pt-2">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted">
              Modules
            </p>
          </div>

          <nav className="space-y-1">
            {/* All Modules Tab */}
            <button
              type="button"
              onClick={() => setActiveModule("ALL")}
              className={cx(
                "flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-label font-medium transition-colors",
                activeModule === "ALL"
                  ? "bg-[#5b4bff]/10 text-[#5b4bff] font-semibold"
                  : "text-ink-soft hover:bg-canvas-deep hover:text-ink",
              )}
            >
              <span className="flex items-center gap-2.5">
                <LayoutGrid className="h-4 w-4" />
                All modules
              </span>
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-micro font-semibold",
                  activeModule === "ALL"
                    ? "bg-[#5b4bff] text-white"
                    : "bg-canvas-deep text-muted",
                )}
              >
                {totalAllPermissions}
              </span>
            </button>

            {/* Individual Modules */}
            {PERMISSION_GROUPS.map((group) => {
              const meta = MODULE_METAS[group.module] ?? {
                icon: Shield,
                bgColor: "bg-slate-500",
                textColor: "text-slate-600",
                description: "",
              };
              const Icon = meta.icon;
              const isCurrent = activeModule === group.module;
              const moduleCount = group.permissions.length;

              return (
                <button
                  key={group.module}
                  type="button"
                  onClick={() => setActiveModule(group.module)}
                  className={cx(
                    "flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-label font-medium transition-colors",
                    isCurrent
                      ? "bg-[#5b4bff]/10 text-[#5b4bff] font-semibold"
                      : "text-ink-soft hover:bg-canvas-deep hover:text-ink",
                  )}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{group.module}</span>
                  </span>
                  <span
                    className={cx(
                      "ml-2 rounded-full px-2 py-0.5 text-micro font-semibold",
                      isCurrent
                        ? "bg-[#5b4bff] text-white"
                        : "bg-canvas-deep text-muted",
                    )}
                  >
                    {moduleCount}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Content Area */}
        <main className="min-w-0 space-y-4">
          {/* Top Filter & Search Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-canvas p-4 shadow-card">
            {/* Search Input */}
            <div className="relative min-w-[200px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search permissions"
                className="w-full rounded-2xl border border-line bg-canvas-deep py-2 pl-9 pr-3.5 text-body text-ink placeholder:text-muted focus:border-accent focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 border-b border-line sm:border-0">
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                className={cx(
                  "relative px-3 py-1.5 text-label font-medium transition-colors",
                  statusFilter === "ALL"
                    ? "text-[#5b4bff] font-semibold after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-[#5b4bff]"
                    : "text-muted hover:text-ink",
                )}
              >
                All ({totalAllPermissions})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("ENABLED")}
                className={cx(
                  "relative px-3 py-1.5 text-label font-medium transition-colors",
                  statusFilter === "ENABLED"
                    ? "text-[#5b4bff] font-semibold after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-[#5b4bff]"
                    : "text-muted hover:text-ink",
                )}
              >
                Enabled ({enabledCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("DISABLED")}
                className={cx(
                  "relative px-3 py-1.5 text-label font-medium transition-colors",
                  statusFilter === "DISABLED"
                    ? "text-[#5b4bff] font-semibold after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-[#5b4bff]"
                    : "text-muted hover:text-ink",
                )}
              >
                Disabled ({disabledCount})
              </button>
            </div>

            {/* Bulk Actions */}
            {!role.isWildcard && canManage && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleEnableAll}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-meta font-medium text-[#5b4bff] transition-colors hover:bg-[#5b4bff]/10"
                >
                  <Check className="h-3.5 w-3.5" />
                  Enable all
                </button>
                <button
                  type="button"
                  onClick={handleDisableAll}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-meta font-medium text-muted transition-colors hover:bg-canvas-deep hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                  Disable all
                </button>
              </div>
            )}
          </div>

          {/* Module Cards List */}
          {filteredGroups.length === 0 ? (
            <div className="rounded-3xl border border-line bg-canvas p-12 text-center shadow-card">
              <p className="text-section font-semibold text-ink">No permissions found</p>
              <p className="mt-1 text-body text-muted">
                Try adjusting your search query or switching filters.
              </p>
              {(searchQuery || statusFilter !== "ALL" || activeModule !== "ALL") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                    setActiveModule("ALL");
                  }}
                  className="mt-4 inline-flex items-center rounded-xl bg-canvas-deep px-4 py-2 text-label font-medium text-ink hover:bg-line transition-colors"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const meta = MODULE_METAS[group.module] ?? {
                icon: Shield,
                bgColor: "bg-slate-500",
                textColor: "text-slate-600",
                description: "Module capabilities and system privileges.",
              };
              const ModuleIcon = meta.icon;
              const isExpanded = expandedModules[group.module] ?? true;

              // Check module master toggle state
              const allModuleKeys = group.permissions.map((p) => p.key);
              const grantableModuleKeys = allModuleKeys.filter((k) => grantable.has(k));

              const isModuleFullyEnabled =
                role.isWildcard ||
                (grantableModuleKeys.length > 0 &&
                  grantableModuleKeys.every((k) => selectedPermissions.has(k)));

              return (
                <section
                  key={group.module}
                  aria-labelledby={`module-heading-${group.module}`}
                  className="rounded-3xl border border-line bg-canvas shadow-card transition-shadow"
                >
                  {/* Module Header Card */}
                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    {/* Left: Icon & Name & Description */}
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                      <div
                        className={cx(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm",
                          meta.bgColor,
                        )}
                      >
                        <ModuleIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3
                            id={`module-heading-${group.module}`}
                            className="text-section font-semibold text-ink"
                          >
                            {group.module}
                          </h3>
                          <span className="rounded-lg bg-canvas-deep px-2 py-0.5 text-micro font-medium text-muted">
                            {group.permissions.length} permissions
                          </span>
                        </div>
                        <p className="mt-0.5 text-meta text-muted truncate">
                          {meta.description}
                        </p>
                      </div>
                    </div>

                    {/* Right: Expand Button & Master Toggle */}
                    <div className="flex items-center gap-4 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleExpandModule(group.module)}
                        className="inline-flex items-center gap-1 text-meta font-medium text-muted hover:text-ink transition-colors"
                      >
                        {isExpanded ? "Collapse" : "Expand all"}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {/* Master Module Toggle */}
                      <div className="pl-2 border-l border-line">
                        <Toggle
                          id={`module-toggle-${group.module}`}
                          label=""
                          checked={isModuleFullyEnabled}
                          disabled={role.isWildcard || !canManage || grantableModuleKeys.length === 0}
                          onChange={(checked) => handleToggleModule(group, checked)}
                          className="m-0"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Permissions List */}
                  {isExpanded && (
                    <div className="border-t border-line/60 bg-canvas-deep/30 px-5 py-4 divide-y divide-line/40">
                      {group.permissions.map((perm) => {
                        const isGranted = role.isWildcard || selectedPermissions.has(perm.key);
                        const isGrantable = grantable.has(perm.key);

                        return (
                          <div
                            key={perm.key}
                            className="flex items-start justify-between gap-4 py-3.5 first:pt-1 last:pb-1"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-baseline gap-2">
                                <label
                                  htmlFor={`perm-toggle-${perm.key}`}
                                  className={cx(
                                    "text-body font-semibold cursor-pointer",
                                    !isGrantable && !role.isWildcard ? "text-muted" : "text-ink",
                                  )}
                                >
                                  {perm.label}
                                </label>
                                <span className="font-mono text-micro text-faint">
                                  {perm.key}
                                </span>
                              </div>
                              <p className="mt-0.5 text-meta text-muted">
                                {perm.description}
                              </p>
                              {perm.pendingNote && (
                                <p className="mt-1 text-micro font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded inline-block">
                                  {perm.pendingNote}
                                </p>
                              )}
                              {!isGrantable && !role.isWildcard && (
                                <p className="mt-1 text-micro text-muted italic">
                                  You do not hold this permission, so you cannot grant it.
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 pt-0.5">
                              <Toggle
                                id={`perm-toggle-${perm.key}`}
                                label=""
                                checked={isGranted}
                                disabled={role.isWildcard || !canManage || !isGrantable}
                                onChange={(checked) => handleTogglePermission(perm.key, checked)}
                                className="m-0"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </main>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-canvas/95 backdrop-blur-md px-6 py-4 shadow-float">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={role.isWildcard || !canManage || !isDirty || isSaving}
              isBusy={isSaving}
              busyLabel="Saving permissions…"
            >
              Save permissions
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onBack}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>

          <div className="flex items-center gap-4">
            {isDirty && (
              <span className="hidden text-meta font-medium text-muted sm:inline">
                Unsaved changes
              </span>
            )}
            <button
              type="button"
              onClick={handleReset}
              disabled={!isDirty || isSaving || role.isWildcard}
              className="inline-flex items-center gap-1.5 text-label font-medium text-muted hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-4 w-4" />
              Reset changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
