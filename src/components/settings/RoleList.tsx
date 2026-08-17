"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { PERMISSION_GROUPS } from "@/lib/permissions";
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
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.module} className="min-w-0">
          <legend className="mb-2 text-sm font-bold text-slate-900">{group.module}</legend>
          <ul className="grid gap-2">
            {group.permissions.map((permission) => {
              const id = `${idPrefix}-${permission.key}`;
              const isGrantable = grantable.has(permission.key);

              return (
                <li key={permission.key}>
                  <label
                    htmlFor={id}
                    className={`flex items-start gap-3 rounded-md p-2 transition-colors ${
                      isGrantable ? "hover:bg-slate-50 cursor-pointer" : "opacity-60 cursor-not-allowed"
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
                      className="mt-1 size-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-600/20"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {permission.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {permission.description}
                      </span>
                      {permission.pendingNote && (
                        // Says so rather than implying protection that does not
                        // exist yet — ticking this box changes nothing today.
                        <span className="mt-1 block text-xs text-amber-700 font-medium">
                          {permission.pendingNote}
                        </span>
                      )}
                      {!isGrantable && (
                        <span className="mt-1 block text-xs text-slate-400">
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
        <h2 id="roles-heading" className="text-lg font-bold text-slate-900">
          Roles
        </h2>
        {canManage && !isAdding && (
          <Button onClick={() => setIsAdding(true)} variant="commit">
            Add Role
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {isAdding && (
        <Card className="mb-6 p-4 sm:p-6 bg-slate-50 border-slate-200">
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

            <div className="bg-white rounded-xl border border-slate-200 p-5">
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
                variant="commit"
                isBusy={isSaving}
                busyLabel="Creating…"
              >
                Create Role
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
              className={`rounded-xl border p-5 shadow-sm transition-colors ${
                isEditing ? "border-violet-200 bg-violet-50/30" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <p className="font-semibold text-slate-900">{role.name}</p>
                <p className="text-sm font-medium text-slate-500">
                  {role.assignmentCount === 1
                    ? "1 assignment"
                    : `${role.assignmentCount} assignments`}
                </p>
              </div>

              {role.isWildcard ? (
                <p className="text-sm text-slate-600">
                  Full access to everything. Permissions for this role are not
                  editable here — create a custom role instead.
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  {role.permissions.length === 0
                    ? "No permissions — this role can sign in and do nothing else."
                    : `${role.permissions.length} permission${
                        role.permissions.length === 1 ? "" : "s"
                      }`}
                </p>
              )}

              {canManage && !role.isWildcard && !isEditing && (
                <div className="mt-5 pt-4 border-t border-slate-100">
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
                <div className="mt-6 pt-6 border-t border-slate-200/60">
                  <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5 shadow-sm">
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
                      variant="commit"
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
