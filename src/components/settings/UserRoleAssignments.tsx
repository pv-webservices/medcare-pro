"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
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
  canAssignAccountWide: boolean;
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
    <section aria-labelledby="assignments-heading" className="mt-12 border-t border-line pt-8">
      <h2 id="assignments-heading" className="mb-1 text-heading font-semibold text-ink">
        Users
      </h2>
      <p className="mb-6 text-body text-muted">
        A role with no clinic applies across the whole account. Naming a clinic
        limits it to that clinic only.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-xl bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      <ul className="grid gap-4">
        {users.map((user) => (
          <li
            key={user.id}
            className={`rounded-xl border p-5 border border-line shadow-card transition-colors ${
              openUserId === user.id ? "border-line bg-accent-soft/30" : "border-line bg-canvas"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <p className="font-semibold text-ink">
                {user.name ?? user.email}
                {user.isSelf && (
                  <span className="ml-3 rounded-lg bg-canvas-deep px-2 py-0.5 text-meta font-medium text-muted">
                    You
                  </span>
                )}
              </p>
              <p className="text-body font-medium text-muted">{user.email}</p>
            </div>

            {user.assignments.length === 0 ? (
              <p className="text-body text-muted italic">
                No roles. This user can sign in but cannot reach any module.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {user.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex items-center gap-3 rounded-lg bg-canvas-deep py-1.5 pl-3 pr-1.5"
                  >
                    <span className="text-body font-medium text-ink">
                      {assignment.roleName}
                      <span className="text-muted font-normal">
                        {"·"}
                        {assignment.clinicName ?? "all clinics"}
                      </span>
                    </span>
                    {canManage &&
                      (assignment.clinicId !== null || canAssignAccountWide) && (
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
                        className="min-h-8 rounded-lg px-2.5 text-meta font-medium text-muted hover:bg-canvas-deep hover:text-ink transition-colors disabled:opacity-50 ml-2"
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
                <div className="mt-5 pt-5 border-t border-line/60 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <Select
                      id={`role-${user.id}`}
                      label="Role"
                      value={roleId}
                      onChange={(event) => setRoleId(event.target.value)}
                    >
                      <option value="">Select a role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <Select
                      id={`clinic-${user.id}`}
                      label="Clinic"
                      value={clinicId}
                      onChange={(event) => setClinicId(event.target.value)}
                    >
                      {canAssignAccountWide && (
                        <option value="">All clinics (account-wide)</option>
                      )}
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2 pb-0.5">
                    <Button
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
                      variant="primary"
                      isBusy={pending === user.id}
                      busyLabel="Assigning…"
                    >
                      Assign Role
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setOpenUserId(null)}
                      variant="secondary"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 pt-4 border-t border-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setOpenUserId(user.id);
                      setRoleId("");
                      setClinicId(
                        canAssignAccountWide ? "" : (clinics[0]?.id ?? ""),
                      );
                    }}
                  >
                    Add Role
                  </Button>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
