"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import {
  ACTION_PERMISSION_GROUPS,
  DASHBOARD_PERMISSION_GROUP,
  type PermissionGroup,
} from "@/lib/permissions";
import type { RoleSummary } from "@/lib/roles";

/**
 * Roles and their permissions — PRD §6.8 (FR-8.1).
 *
 * Permissions are grouped by module and worded as capabilities ("Add
 * registrations"), not as the raw `registration:create` strings the server
 * matches. An owner deciding what a receptionist may do should not have to read
 * the permission format to do it.
 *
 * A role holding full access is shown but not editable here. The catalogue has
 * no checkbox for the wildcard — deliberately, so this screen can never mint an
 * owner — which means saving one through these boxes would silently strip its
 * access. Refusing is clearer than a checkbox that quietly demotes.
 */

interface RoleListProps {
  roles: readonly RoleSummary[];
  /** What this actor may tick. Anything else renders disabled with a reason. */
  grantablePermissions: readonly string[];
  canManage: boolean;
}

function PermissionCheckboxes({
  idPrefix,
  selected,
  grantable,
  onToggle,
}: {
  idPrefix: string;
  selected: ReadonlySet<string>;
  grantable: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
}) {
  const sections: readonly {
    title: string;
    description: string;
    groups: readonly PermissionGroup[];
  }[] = [
    {
      title: "Assigned Rights",
      description: "Controls what operations this role can perform.",
      groups: ACTION_PERMISSION_GROUPS,
    },
    {
      title: "Dashboard Data",
      description: "Controls which dashboard cards, summaries, and populated data this role can see.",
      groups: [DASHBOARD_PERMISSION_GROUP],
    },
  ];

  return (
    <div className="grid gap-8">
      {sections.map((section) => (
        <section key={section.title} aria-labelledby={`${idPrefix}-${section.title.replaceAll(" ", "-").toLowerCase()}`}>
          <h3
            id={`${idPrefix}-${section.title.replaceAll(" ", "-").toLowerCase()}`}
            className="text-title font-semibold text-ink"
          >
            {section.title}
          </h3>
          <p className="mt-1 text-body text-muted">{section.description}</p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {section.groups.map((group) => (
              <fieldset key={group.module} className="min-w-0">
                <legend className="mb-2 text-body font-semibold text-ink">
                  {section.title === "Dashboard Data" ? "Dashboard sections" : group.module}
                </legend>
                <ul className="grid gap-2">
                  {group.permissions.map((permission) => {
                    const id = `${idPrefix}-${permission.key}`;
                    const isGrantable = grantable.has(permission.key);

                    return (
                      <li key={permission.key}>
                        <label
                          htmlFor={id}
                          className={`flex items-start gap-3 rounded-lg p-2 transition-colors ${
                            isGrantable ? "hover:bg-canvas-deep cursor-pointer" : "opacity-60 cursor-not-allowed"
                          }`}
                        >
                          <input
                            id={id}
                            type="checkbox"
                            checked={selected.has(permission.key)}
                            disabled={!isGrantable}
                            onChange={(event) =>
                              onToggle(permission.key, event.target.checked)
                            }
                            className="mt-1 size-4 shrink-0 rounded border-line text-accent"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-body font-semibold text-ink">
                              {permission.label}
                            </span>
                            <span className="block text-meta text-muted">
                              {permission.description}
                            </span>
                            {permission.pendingNote && (
                              <span className="mt-1 block text-meta text-warn-ink font-medium">
                                {permission.pendingNote}
                              </span>
                            )}
                            {!isGrantable && (
                              <span className="mt-1 block text-meta text-faint">
                                You do not hold this permission, so you cannot grant it.
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function RoleList({
  roles,
  grantablePermissions,
  canManage,
}: RoleListProps) {
  const router = useRouter();
  const grantable = new Set(grantablePermissions);

  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; permissions: Set<string> } | null>(
    null,
  );
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  async function send(
    method: "POST" | "PATCH",
    body: object,
    onDone: () => void,
  ): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/roles", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        // Covers the 409 for a duplicate name and the 400 for granting beyond
        // your own reach — both are written for the user by the server.
        setError(payload.error ?? "Could not save that role. Try again.");
        return;
      }

      onDone();
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    await send(
      "POST",
      { name: newName, permissions: [...newPermissions] },
      () => {
        setNewName("");
        setNewPermissions(new Set());
        setIsAdding(false);
      },
    );
    setIsSaving(false);
  }

  async function handleSaveRole(roleId: string) {
    if (!editing) return;
    setSavingRoleId(roleId);
    await send(
      "PATCH",
      { action: "updateRole", roleId, permissions: [...editing.permissions] },
      () => setEditing(null),
    );
    setSavingRoleId(null);
  }

  function toggle(set: Set<string>, key: string, checked: boolean): Set<string> {
    // New Set rather than mutating: the old one is still React's current state.
    const next = new Set(set);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    return next;
  }

  return (
    <section aria-labelledby="roles-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="roles-heading" className="text-heading font-semibold text-ink">
          Roles
        </h2>
        {canManage && !isAdding && (
          <Button onClick={() => setIsAdding(true)} variant="primary">
            Add Role
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {isAdding && (
        <Card className="mb-6 p-4 sm:p-6 bg-canvas-deep border-line">
          <form onSubmit={handleCreate} className="grid gap-6">
            <div className="max-w-md">
              <Input
                id="new-role-name"
                name="name"
                label="Role name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
                maxLength={255}
                placeholder="e.g. Billing Desk"
              />
            </div>

            <div className="bg-canvas rounded-3xl p-5 border border-line shadow-card">
              <PermissionCheckboxes
                idPrefix="new-role"
                selected={newPermissions}
                grantable={grantable}
                onToggle={(key, checked) =>
                  setNewPermissions((current) => toggle(current, key, checked))
                }
              />
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                variant="primary"
                isBusy={isSaving}
                busyLabel="Creating…"
              >
                Create role
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setNewPermissions(new Set());
                  setNewName("");
                }}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {roles.map((role) => {
          const isEditing = editing?.id === role.id;

          return (
            <li
              key={role.id}
              className={`rounded-xl border p-5 border border-line shadow-card transition-colors ${
                isEditing ? "border-line bg-accent-soft/30" : "border-line bg-canvas"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <p className="font-semibold text-ink">{role.name}</p>
                <p className="text-body font-medium text-muted">
                  {role.assignmentCount === 1
                    ? "1 assignment"
                    : `${role.assignmentCount} assignments`}
                </p>
              </div>

              {role.isWildcard ? (
                <p className="text-body text-muted">
                  Full access to everything. Permissions for this role are not
                  editable here — create a custom role instead.
                </p>
              ) : (
                <p className="text-body text-muted">
                  {role.permissions.length === 0
                    ? "No permissions — this role can sign in and do nothing else."
                    : `${role.permissions.length} permission${
                        role.permissions.length === 1 ? "" : "s"
                      }`}
                </p>
              )}

              {canManage && !role.isWildcard && !isEditing && (
                <div className="mt-5 pt-4 border-t border-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditing({ id: role.id, permissions: new Set(role.permissions) })
                    }
                  >
                    Edit Permissions
                  </Button>
                </div>
              )}

              {isEditing && editing && (
                <div className="mt-6 pt-6 border-t border-line/60">
                  <div className="bg-canvas rounded-xl p-5 mb-5 border border-line shadow-card">
                    <PermissionCheckboxes
                      idPrefix={`role-${role.id}`}
                      selected={editing.permissions}
                      grantable={grantable}
                      onToggle={(key, checked) =>
                        setEditing((current) =>
                          current === null
                            ? current
                            : {
                                ...current,
                                permissions: toggle(current.permissions, key, checked),
                              },
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={() => handleSaveRole(role.id)}
                      disabled={savingRoleId === role.id}
                      variant="primary"
                      isBusy={savingRoleId === role.id}
                      busyLabel="Saving…"
                    >
                      Save Permissions
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setEditing(null)}
                      variant="secondary"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
