"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountUser, RoleSummary } from "@/lib/roles";

/**
 * Who holds which role, and where — PRD §6.8 (FR-8.2).
 *
 * An assignment with no clinic is account-wide; one naming a clinic reaches
 * only that clinic. Both are shown in the same list because a user can hold
 * different roles in different clinics, and reading that as one row per
 * assignment is how the data actually works.
 *
 * The server refuses an assignment that would grant more than the actor holds,
 * and refuses to remove the last account-wide owner. This screen does not
 * duplicate those rules — it just shows the message the server sends back.
 */

interface UserRoleAssignmentsProps {
  users: readonly AccountUser[];
  roles: readonly RoleSummary[];
  clinics: readonly { id: string; name: string }[];
  canManage: boolean;
}

const SELECT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

export default function UserRoleAssignments({
  users,
  roles,
  clinics,
  canManage,
}: UserRoleAssignmentsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function send(body: object, key: string): Promise<void> {
    setError(null);
    setPending(key);
    try {
      const response = await fetch("/api/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        // Covers the 409 that stops the last owner being removed, and the 400
        // that stops granting beyond your own reach.
        setError(payload.error ?? "Could not update that assignment. Try again.");
        return;
      }

      setOpenUserId(null);
      setRoleId("");
      setClinicId("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="assignments-heading">
      <h2 id="assignments-heading" className="mb-1 text-lg font-semibold">
        Users
      </h2>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        A role with no clinic applies across the whole account. Naming a clinic
        limits it to that clinic only.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <ul className="grid gap-3">
        {users.map((user) => (
          <li
            key={user.id}
            className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {user.name ?? user.email}
                {user.isSelf && (
                  <span className="ml-2 rounded bg-black/10 px-2 py-0.5 text-xs font-medium dark:bg-white/15">
                    You
                  </span>
                )}
              </p>
              <p className="text-sm text-black/60 dark:text-white/60">{user.email}</p>
            </div>

            {user.assignments.length === 0 ? (
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                No roles. This user can sign in but cannot reach any module.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {user.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex items-center gap-2 rounded border border-black/15 py-1 pl-3 pr-1 dark:border-white/20"
                  >
                    <span className="text-sm">
                      {assignment.roleName}
                      <span className="text-black/55 dark:text-white/55">
                        {" · "}
                        {assignment.clinicName ?? "all clinics"}
                      </span>
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() =>
                          send(
                            { action: "unassign", assignmentId: assignment.id },
                            assignment.id,
                          )
                        }
                        disabled={pending === assignment.id}
                        aria-label={`Remove ${assignment.roleName} in ${
                          assignment.clinicName ?? "all clinics"
                        } from ${user.name ?? user.email}`}
                        className="min-h-9 rounded px-2 text-sm text-black/60 hover:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
                      >
                        {pending === assignment.id ? "…" : "Remove"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage &&
              (openUserId === user.id ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <label
                      htmlFor={`role-${user.id}`}
                      className="mb-1 block text-sm font-medium"
                    >
                      Role
                    </label>
                    <select
                      id={`role-${user.id}`}
                      value={roleId}
                      onChange={(event) => setRoleId(event.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">Select a role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`clinic-${user.id}`}
                      className="mb-1 block text-sm font-medium"
                    >
                      Clinic
                    </label>
                    <select
                      id={`clinic-${user.id}`}
                      value={clinicId}
                      onChange={(event) => setClinicId(event.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">All clinics (account-wide)</option>
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={roleId === "" || pending === user.id}
                      onClick={() =>
                        send(
                          {
                            action: "assign",
                            userId: user.id,
                            roleId,
                            ...(clinicId === "" ? {} : { clinicId }),
                          },
                          user.id,
                        )
                      }
                      className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
                    >
                      {pending === user.id ? "Assigning…" : "Assign Role"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenUserId(null)}
                      className="min-h-11 rounded border border-black/20 px-4 text-base font-medium dark:border-white/25"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpenUserId(user.id);
                    setRoleId("");
                    setClinicId("");
                  }}
                  className="mt-2 min-h-11 rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
                >
                  Add Role
                </button>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
