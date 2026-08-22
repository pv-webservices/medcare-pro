"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { MembershipStatus } from "@prisma/client";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import type { TeamMember } from "@/lib/team";

/**
 * The people in this organisation — Stage 6.
 *
 * ROLES ARE READ-ONLY HERE, on purpose. `user_roles` has exactly two writers
 * (see the note at the top of src/lib/team.ts) and this screen is neither; the
 * link goes to the Roles screen, where `role:manage` and its escalation guards
 * live. Showing the roles without offering to edit them is the honest version.
 *
 * WHAT THE BUTTONS DO NOT DO. Hiding a control is not access control — every
 * action re-checks its permission, the tenant, the status transition and the
 * last-owner rule server-side. The buttons are hidden from someone who cannot
 * use them purely so they are not offered a door that will refuse them.
 */

interface TeamMembersProps {
  members: TeamMember[];
  canApprove: boolean;
  canManage: boolean;
}

type TeamAction = "approve" | "reject" | "suspend" | "reactivate" | "remove";

const STATUS_TONE: Record<MembershipStatus, StatusTone> = {
  ACTIVE: "ok",
  PENDING: "warn",
  SUSPENDED: "alert",
  REJECTED: "alert",
  REMOVED: "neutral",
};

const STATUS_LABEL: Record<MembershipStatus, string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
  REMOVED: "Removed",
};

/**
 * Confirmation copy for the actions that take access away. Removal is terminal
 * — `MEMBERSHIP_STATUS_TRANSITIONS` has no way back out of REMOVED — so it says
 * so rather than letting someone discover it afterwards.
 */
const CONFIRM: Partial<Record<TeamAction, (name: string) => string>> = {
  suspend: (name) =>
    `Suspend ${name}? They will be signed out everywhere and cannot sign in until you reactivate them.`,
  reject: (name) => `Reject ${name}? They will not be able to sign in.`,
  remove: (name) =>
    `Remove ${name}? This cannot be undone — they would need a new invitation, and their email address stays taken.`,
};

function formatLastSeen(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function TeamMembers({
  members,
  canApprove,
  canManage,
}: TeamMembersProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(member: TeamMember, action: TeamAction) {
    const who = member.name?.trim() || member.email;
    const confirmation = CONFIRM[action]?.(who);
    if (confirmation && !window.confirm(confirmation)) {
      return;
    }
    if (busyId) {
      return;
    }

    setBusyId(member.id);
    try {
      const response = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: member.id }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        showToast({
          tone: "alert",
          title: body.error ?? "Could not make that change. Try again.",
        });
        return;
      }

      showToast({ tone: "ok", title: `${who} updated.` });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server. Check your connection.",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="No one here yet."
        guidance="Invite a colleague and they will appear once they set their password."
      />
    );
  }

  return (
    <div className="space-y-3">
    <Table caption="People in this organisation">
      <THead>
        <TH>Name</TH>
        <TH>Roles</TH>
        <TH>Status</TH>
        <TH>Last signed in</TH>
        <TH align="end">Actions</TH>
      </THead>
      <TBody>
        {members.map((member) => {
          const isBusy = busyId === member.id;
          const isLocked = member.isSelf;

          return (
            <TR key={member.id}>
              <TD>
                <span className="block font-semibold text-slate-900">
                  {member.name?.trim() || "—"}
                  {member.isSelf && (
                    <span className="ml-2 text-xs font-medium text-slate-400">
                      You
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">{member.email}</span>
              </TD>

              <TD>
                {member.roles.length === 0 ? (
                  <span className="text-slate-400">No role</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {member.roles.map((role, index) => (
                      <StatusPill
                        key={`${member.id}-${index}`}
                        tone="neutral"
                        hasDot={false}
                      >
                        {role.roleName}
                        {role.clinicName ? ` · ${role.clinicName}` : ""}
                      </StatusPill>
                    ))}
                  </span>
                )}
              </TD>

              <TD>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone={STATUS_TONE[member.membershipStatus]}>
                    {STATUS_LABEL[member.membershipStatus]}
                  </StatusPill>
                  {member.isBlockedByPlatform && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
                      title="Access is on hold at the platform level. Contact support."
                    >
                      <ShieldAlert
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.75}
                      />
                      On hold
                    </span>
                  )}
                </span>
              </TD>

              <TD className="tabular-nums">{formatLastSeen(member.lastLoginAt)}</TD>

              <TD align="end">
                <span className="flex flex-wrap justify-end gap-2">
                  {member.membershipStatus === "PENDING" && canApprove && !isLocked && (
                    <>
                      <Button
                        size="sm"
                        variant="commit"
                        isBusy={isBusy}
                        busyLabel="Working..."
                        onClick={() => run(member, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={isBusy}
                        onClick={() => run(member, "reject")}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {member.membershipStatus === "ACTIVE" && canManage && !isLocked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => run(member, "suspend")}
                    >
                      Suspend
                    </Button>
                  )}

                  {member.membershipStatus === "SUSPENDED" && canManage && !isLocked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => run(member, "reactivate")}
                    >
                      Reactivate
                    </Button>
                  )}

                  {member.membershipStatus !== "REMOVED" && canManage && !isLocked && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isBusy}
                      onClick={() => run(member, "remove")}
                    >
                      Remove
                    </Button>
                  )}

                  {isLocked && (
                    <span className="text-xs text-slate-400">
                      Ask another admin
                    </span>
                  )}
                </span>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>

    <p className="px-1 text-xs text-slate-500">
      Roles are changed on the{" "}
      <Link href="/settings/roles" className="font-medium text-primary underline">
        Roles screen
      </Link>
      , where the permission checks for them live.
    </p>
    </div>
  );
}
