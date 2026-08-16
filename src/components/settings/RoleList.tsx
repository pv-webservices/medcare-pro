"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

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
    <div className="grid gap-4 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.module} className="min-w-0">
          <legend className="mb-1 text-sm font-semibold">{group.module}</legend>
          <ul className="grid gap-1">
            {group.permissions.map((permission) => {
              const id = `${idPrefix}-${permission.key}`;
              const isGrantable = grantable.has(permission.key);

              return (
                <li key={permission.key}>
                  <label
                    htmlFor={id}
                    className={`flex min-h-11 items-start gap-2 rounded px-1 py-1 ${
                      isGrantable ? "" : "opacity-60"
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
                      className="mt-1 size-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {permission.label}
                      </span>
                      <span className="block text-xs text-black/60 dark:text-white/60">
                        {permission.description}
                      </span>
                      {permission.pendingNote && (
                        // Says so rather than implying protection that does not
                        // exist yet — ticking this box changes nothing today.
                        <span className="mt-0.5 block text-xs text-amber-800 dark:text-amber-400">
                          {permission.pendingNote}
                        </span>
                      )}
                      {!isGrantable && (
                        <span className="mt-0.5 block text-xs text-black/60 dark:text-white/60">
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
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="roles-heading" className="text-lg font-semibold">
          Roles
        </h2>
        {canManage && !isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
          >
            Add Role
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {isAdding && (
        <form
          onSubmit={handleCreate}
          className="mb-4 rounded border border-black/15 p-3 dark:border-white/20"
        >
          <div className="mb-3 max-w-sm">
            <label htmlFor="new-role-name" className="mb-1 block text-sm font-medium">
              Role name
            </label>
            <input
              id="new-role-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              required
              maxLength={255}
              placeholder="e.g. Billing Desk"
              className={INPUT_CLASS}
            />
          </div>

          <PermissionCheckboxes
            idPrefix="new-role"
            selected={newPermissions}
            grantable={grantable}
            onToggle={(key, checked) =>
              setNewPermissions((current) => toggle(current, key, checked))
            }
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
            >
              {isSaving ? "Creating…" : "Create Role"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewPermissions(new Set());
                setNewName("");
              }}
              className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="grid gap-3">
        {roles.map((role) => {
          const isEditing = editing?.id === role.id;

          return (
            <li
              key={role.id}
              className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{role.name}</p>
                <p className="text-sm text-black/60 dark:text-white/60">
                  {role.assignmentCount === 1
                    ? "1 assignment"
                    : `${role.assignmentCount} assignments`}
                </p>
              </div>

              {role.isWildcard ? (
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Full access to everything. Permissions for this role are not
                  editable here — create a custom role instead.
                </p>
              ) : (
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {role.permissions.length === 0
                    ? "No permissions — this role can sign in and do nothing else."
                    : `${role.permissions.length} permission${
                        role.permissions.length === 1 ? "" : "s"
                      }`}
                </p>
              )}

              {canManage && !role.isWildcard && !isEditing && (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ id: role.id, permissions: new Set(role.permissions) })
                  }
                  className="mt-2 min-h-11 rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
                >
                  Edit Permissions
                </button>
              )}

              {isEditing && editing && (
                <div className="mt-3">
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveRole(role.id)}
                      disabled={savingRoleId === role.id}
                      className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
                    >
                      {savingRoleId === role.id ? "Saving…" : "Save Permissions"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
                    >
                      Cancel
                    </button>
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
