"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Pencil,
  Plus,
  Shield,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Menu, { menuItemClasses } from "@/components/ui/Menu";
import { cx } from "@/components/ui/cx";
import type { RoleSummary } from "@/lib/roles";
import { getRoleVisual } from "@/components/settings/roleVisuals";

/**
 * Roles & permissions overview grid — PRD §6.8 (FR-8.1).
 *
 * Displays a clean, compact 3-column responsive card grid for all roles
 * (Admin, Doctor, Executive, Owner, Receptionist, Staff, and custom roles)
 * matching 02-roles-permission.png.
 */

interface RoleListProps {
  roles: readonly RoleSummary[];
  grantablePermissions: readonly string[];
  canManage: boolean;
  onEditRole: (roleId: string) => void;
}

export default function RoleList({
  roles,
  canManage,
  onEditRole,
}: RoleListProps) {
  const router = useRouter();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick creation of role with empty or base permissions
  const handleCreateRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!newRoleName.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRoleName.trim(),
          permissions: [],
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not create role. Try again.");
        setIsSaving(false);
        return;
      }

      setIsAddModalOpen(false);
      setNewRoleName("");
      setIsSaving(false);
      router.refresh();

      // Open new role in permission editor right away
      if (payload.data?.id) {
        onEditRole(payload.data.id);
      }
    } catch {
      setError("Network error. Could not connect to the server.");
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-meta text-muted">
            <span className="text-muted">Settings</span>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <span className="text-ink font-medium">Roles &amp; permissions</span>
          </nav>
          <h1 className="text-display font-semibold tracking-tight text-ink">
            Roles &amp; permissions
          </h1>
          <p className="mt-1 text-body text-muted">
            Define what each role can see and do. Create roles, manage permissions, and assign them to users.
          </p>
        </div>

        {canManage && (
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsAddModalOpen(true)}
            className="shrink-0"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Role
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-alert-border bg-alert-bg p-4 text-body text-alert-ink"
        >
          {error}
        </div>
      )}

      {/* Role Card Grid (3 columns on desktop, 2 on tablet, 1 on mobile) */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => {
          const visual = getRoleVisual(role.name, role.isWildcard);
          const Icon = visual.icon;

          return (
            <div
              key={role.id}
              className="flex flex-col justify-between rounded-3xl border border-line bg-canvas p-6 shadow-card transition-shadow hover:shadow-float"
            >
              <div>
                {/* Top Row: Icon + Role Name + Overflow Menu */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={cx(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm",
                        visual.bgColor,
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div>
                      <h2 className="text-section font-semibold text-ink leading-snug">
                        {role.name}
                      </h2>
                    </div>
                  </div>

                  <Menu
                    align="end"
                    label={`Options for ${role.name}`}
                    trigger={({ isOpen }) => (
                      <div
                        className={cx(
                          "flex h-8 w-8 items-center justify-center rounded-xl text-muted transition-colors hover:bg-canvas-deep hover:text-ink",
                          isOpen && "bg-canvas-deep text-ink",
                        )}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </div>
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onEditRole(role.id)}
                      className={menuItemClasses(false)}
                    >
                      <Pencil className="h-4 w-4 text-muted" />
                      Edit permissions
                    </button>
                  </Menu>
                </div>

                {/* Sub-line Stats: Permissions count + Assignments count */}
                <div className="mt-4 flex items-center gap-4 text-meta text-muted">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Shield className="h-3.5 w-3.5 text-muted" />
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

              {/* Bottom Action: Edit permissions */}
              <div className="mt-5 pt-4 border-t border-line/60">
                <button
                  type="button"
                  onClick={() => onEditRole(role.id)}
                  className="inline-flex items-center gap-2 text-label font-semibold text-[#5b4bff] hover:text-[#4a39e8] transition-colors focus-visible:outline-none focus-visible:underline"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit permissions
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Role Modal Dialog */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setNewRoleName("");
          setError(null);
        }}
        title="Add Role"
        description="Create a new custom role to configure its operational permissions."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsAddModalOpen(false);
                setNewRoleName("");
                setError(null);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-role-form"
              variant="primary"
              disabled={!newRoleName.trim() || isSaving}
              isBusy={isSaving}
              busyLabel="Creating…"
            >
              Create and configure
            </Button>
          </>
        }
      >
        <form id="add-role-form" onSubmit={handleCreateRole} className="space-y-4">
          <Input
            id="role-name-input"
            label="Role name"
            placeholder="e.g. Lab Technician, Billing Manager"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            required
            maxLength={255}
            autoFocus
          />
          <p className="text-meta text-muted">
            You will be taken directly to the permission manager to configure what this role can see and do.
          </p>
        </form>
      </Modal>
    </div>
  );
}
