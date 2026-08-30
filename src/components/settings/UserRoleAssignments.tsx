"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import Menu, { menuItemClasses } from "@/components/ui/Menu";
import Select from "@/components/ui/Select";
import { cx } from "@/components/ui/cx";
import type { AccountUser, RoleSummary } from "@/lib/roles";

/**
 * Users and Role Assignments List — PRD §6.8 (FR-8.2).
 *
 * Compact operational list matching 02-roles-permission.png:
 * - Avatar with user initials
 * - Name + "You" badge + email below
 * - Current role chips with clinic scope (e.g. "Owner · All clinics", "Doctor · Sharma Clinic")
 * - "+ Add role" button + 3-dots overflow menu for unassigning
 */

interface UserRoleAssignmentsProps {
  users: readonly AccountUser[];
  roles: readonly RoleSummary[];
  clinics: readonly { id: string; name: string }[];
  canManage: boolean;
  canAssignAccountWide: boolean;
}

// Generate distinct soft background/text colors based on user email/name
function getAvatarStyle(nameOrEmail: string) {
  const hash = nameOrEmail.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palettes = [
    { bg: "bg-blue-100", text: "text-blue-700" },
    { bg: "bg-emerald-100", text: "text-emerald-700" },
    { bg: "bg-purple-100", text: "text-purple-700" },
    { bg: "bg-amber-100", text: "text-amber-700" },
    { bg: "bg-pink-100", text: "text-pink-700" },
    { bg: "bg-teal-100", text: "text-teal-700" },
  ];
  return palettes[hash % palettes.length];
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export default function UserRoleAssignments({
  users,
  roles,
  clinics,
  canManage,
  canAssignAccountWide,
}: UserRoleAssignmentsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Assignment Modal state
  const [assignUser, setAssignUser] = useState<AccountUser | null>(null);
  const [roleId, setRoleId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  // Unassign confirmation state
  const [unassignTarget, setUnassignTarget] = useState<{
    user: AccountUser;
    assignmentId: string;
    roleName: string;
    clinicName: string | null;
  } | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);

  async function send(body: object): Promise<boolean> {
    setError(null);
    try {
      const response = await fetch("/api/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not update role assignment.");
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  const handleOpenAssignModal = (user: AccountUser) => {
    setAssignUser(user);
    setRoleId(roles[0]?.id ?? "");
    setClinicId(canAssignAccountWide ? "" : (clinics[0]?.id ?? ""));
    setError(null);
  };

  const handleConfirmAssign = async () => {
    if (!assignUser || !roleId) return;

    setIsAssigning(true);
    const ok = await send({
      action: "assign",
      userId: assignUser.id,
      roleId,
      ...(clinicId === "" ? {} : { clinicId }),
    });

    setIsAssigning(false);
    if (ok) {
      setAssignUser(null);
      setRoleId("");
      setClinicId("");
    }
  };

  const handleConfirmUnassign = async () => {
    if (!unassignTarget) return;

    setIsUnassigning(true);
    const ok = await send({
      action: "unassign",
      assignmentId: unassignTarget.assignmentId,
    });

    setIsUnassigning(false);
    if (ok) {
      setUnassignTarget(null);
    }
  };

  return (
    <section aria-labelledby="users-heading" className="space-y-4 pt-6">
      {/* Section Header */}
      <div>
        <h2 id="users-heading" className="text-heading font-semibold text-ink">
          Users
        </h2>
        <p className="mt-1 text-body text-muted">
          A role with no clinic applies across the whole account. Naming a clinic limits it to that clinic only.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-alert-border bg-alert-bg p-4 text-body text-alert-ink"
        >
          {error}
        </div>
      )}

      {/* Users Operational Table / List */}
      <div className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
        <div className="divide-y divide-line">
          {users.map((user) => {
            const initials = getInitials(user.name, user.email);
            const avatarStyle = getAvatarStyle(user.email);

            return (
              <div
                key={user.id}
                className="flex flex-col gap-4 p-5 transition-colors hover:bg-canvas-deep/40 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Col 1: Avatar + Name + Email */}
                <div className="flex items-center gap-4 min-w-[240px]">
                  <div
                    className={cx(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-label font-bold shadow-sm",
                      avatarStyle.bg,
                      avatarStyle.text,
                    )}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-semibold text-ink truncate">
                        {user.name || user.email}
                      </span>
                      {user.isSelf && (
                        <span className="rounded-md bg-[#5b4bff]/10 px-1.5 py-0.5 text-micro font-semibold text-[#5b4bff]">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-meta text-muted truncate">{user.email}</p>
                  </div>
                </div>

                {/* Col 2: Current Roles Chips */}
                <div className="min-w-0 flex-1 sm:px-4">
                  <p className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-muted sm:hidden">
                    Current roles
                  </p>
                  {user.assignments.length === 0 ? (
                    <span className="text-meta italic text-muted">
                      No roles assigned
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {user.assignments.map((assignment) => {
                        const isOwnerRole = assignment.roleName.toLowerCase().includes("owner");

                        return (
                          <span
                            key={assignment.id}
                            className={cx(
                              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-meta font-medium shadow-xs",
                              isOwnerRole
                                ? "bg-purple-50 text-purple-700 border border-purple-100"
                                : "bg-blue-50 text-blue-700 border border-blue-100",
                            )}
                          >
                            <span className="font-semibold">{assignment.roleName}</span>
                            <span className="text-line-strong">•</span>
                            <span>{assignment.clinicName ?? "All clinics"}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Col 3: Actions (+ Add role button & Overflow Menu) */}
                {canManage && (
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenAssignModal(user)}
                      className="rounded-xl font-medium"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add role
                    </Button>

                    {user.assignments.length > 0 && (
                      <Menu
                        align="end"
                        label={`Manage roles for ${user.name || user.email}`}
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
                        <div className="px-3 py-2 text-micro font-semibold uppercase tracking-wider text-muted border-b border-line">
                          Remove assignment
                        </div>
                        {user.assignments.map((assignment) => {
                          const canRemove = assignment.clinicId !== null || canAssignAccountWide;
                          return (
                            <button
                              key={assignment.id}
                              type="button"
                              disabled={!canRemove}
                              onClick={() =>
                                setUnassignTarget({
                                  user,
                                  assignmentId: assignment.id,
                                  roleName: assignment.roleName,
                                  clinicName: assignment.clinicName,
                                })
                              }
                              className={cx(
                                menuItemClasses(false, "danger"),
                                !canRemove && "opacity-50 cursor-not-allowed",
                              )}
                            >
                              <Trash2 className="h-4 w-4 shrink-0 text-alert-ink" />
                              <span className="truncate">
                                Remove {assignment.roleName} ({assignment.clinicName ?? "All clinics"})
                              </span>
                            </button>
                          );
                        })}
                      </Menu>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Role Assignment Modal */}
      {assignUser && (
        <Modal
          isOpen={true}
          onClose={() => setAssignUser(null)}
          title="Add role assignment"
          description={`Assign a role and clinic scope to ${assignUser.name || assignUser.email}.`}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAssignUser(null)}
                disabled={isAssigning}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmAssign}
                disabled={!roleId || isAssigning}
                isBusy={isAssigning}
                busyLabel="Assigning…"
              >
                Assign role
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Select
              id="assign-role-select"
              label="Select Role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} {r.isWildcard ? "(Wildcard Owner)" : `(${r.permissions.length} perms)`}
                </option>
              ))}
            </Select>

            <Select
              id="assign-clinic-select"
              label="Clinic Scope"
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
            >
              {canAssignAccountWide && (
                <option value="">All clinics (account-wide)</option>
              )}
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <p className="text-meta text-muted">
              {clinicId === ""
                ? "This role will apply across all current and future clinics under this account."
                : "This role will only grant access when operating inside the selected clinic."}
            </p>
          </div>
        </Modal>
      )}

      {/* Unassign Confirmation Dialog */}
      {unassignTarget && (
        <ConfirmDialog
          isOpen={true}
          onCancel={() => setUnassignTarget(null)}
          onConfirm={handleConfirmUnassign}
          title="Remove role assignment"
          body={
            <span>
              Are you sure you want to remove the{" "}
              <strong>{unassignTarget.roleName}</strong> role (
              {unassignTarget.clinicName ?? "All clinics"}) from{" "}
              <strong>{unassignTarget.user.name || unassignTarget.user.email}</strong>?
            </span>
          }
          confirmLabel="Remove assignment"
          tone="danger"
          isBusy={isUnassigning}
          busyLabel="Removing…"
        />
      )}
    </section>
  );
}
