"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { MembershipStatus } from "@prisma/client";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ConfirmDialog } from "@/components/ui/Modal";
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
    `${name} will be signed out everywhere and cannot sign in until you reactivate them.`,
  reject: (name) => `${name} will not be able to sign in.`,
  remove: (name) =>
    `This cannot be undone. ${name} would need a new invitation, and their email address stays taken.`,
};

/**
 * The verb, used for both the dialog's title and its confirm button — a
 * confirmation whose button says "OK" makes the reader reconstruct which choice
 * is the destructive one from the sentence above it.
 */
const CONFIRM_TITLE: Partial<Record<TeamAction, string>> = {
  suspend: "Suspend this person",
  reject: "Reject this person",
  remove: "Remove this person",
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
  /**
   * The member and action waiting on a confirmation. Suspending, rejecting and
   * removing all change someone's access, so they are asked about in a dialog
   * rather than a browser confirm() — which cannot be styled, speaks in the
   * browser's voice rather than the product's, and on a shared tablet looks
   * like the machine warning you about the page.
   */
  const [pending, setPending] = useState<{
    member: TeamMember;
    action: TeamAction;
  } | null>(null);

  /** What a button calls: confirm first where CONFIRM has wording, else run. */
  function request(member: TeamMember, action: TeamAction) {
    if (CONFIRM[action]) {
      setPending({ member, action });
      return;
    }
    void run(member, action);
  }

  /**
   * Runs the action. The three destructive ones ask first — see `request`
   * above, which is what the buttons actually call.
   */
  async function run(member: TeamMember, action: TeamAction) {
    if (busyId) {
      return;
    }

    const who = member.name?.trim() || member.email;
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
              <TD isPrimary>
                <span className="flex items-center gap-2.5">
                  <Avatar name={member.name?.trim() || member.email} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {member.name?.trim() || member.email}
                      {member.isSelf && (
                        <span className="ml-2 text-meta font-medium text-faint">
                          You
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-meta text-muted">
                      {member.email}
                    </span>
                  </span>
                </span>
              </TD>

              <TD>
                {member.roles.length === 0 ? (
                  <span className="text-faint">No role</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {member.roles.map((role, index) => (
                      <StatusPill
                        key={`${member.id}-${index}`}
                        tone="neutral"
                        hasDot={false}
                      >
                        {role.roleName}
                        {role.clinicName ? ` · ${role.clinicName}` : " · Account-wide"}
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
                      className="inline-flex items-center gap-1 text-meta font-medium text-warn-ink"
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

              <TD className="tnum">{formatLastSeen(member.lastLoginAt)}</TD>

              <TD align="end">
                <span className="flex flex-wrap justify-end gap-2">
                  {member.membershipStatus === "PENDING" && canApprove && !isLocked && (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        isBusy={isBusy}
                        busyLabel="Working..."
                        onClick={() => request(member, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={isBusy}
                        onClick={() => request(member, "reject")}
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
                      onClick={() => request(member, "suspend")}
                    >
                      Suspend
                    </Button>
                  )}

                  {member.membershipStatus === "SUSPENDED" && canManage && !isLocked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => request(member, "reactivate")}
                    >
                      Reactivate
                    </Button>
                  )}

                  {member.membershipStatus !== "REMOVED" && canManage && !isLocked && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isBusy}
                      onClick={() => request(member, "remove")}
                    >
                      Remove
                    </Button>
                  )}

                  {isLocked && (
                    <span className="text-meta text-faint">
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

    <p className="px-1 text-meta text-muted">
      Roles are changed on the{" "}
      <Link
        href="/settings/roles"
        className="rounded font-medium text-accent transition-colors duration-150 hover:text-accent-strong"
      >
        Roles screen
      </Link>
      , where the permission checks for them live.
    </p>

    <ConfirmDialog
      isOpen={pending !== null}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const request = pending;
        setPending(null);
        if (request) {
          void run(request.member, request.action);
        }
      }}
      title={
        pending
          ? `${CONFIRM_TITLE[pending.action] ?? "Confirm"}?`
          : "Confirm"
      }
      body={
        pending
          ? (CONFIRM[pending.action]?.(
              pending.member.name?.trim() || pending.member.email,
            ) ?? "")
          : ""
      }
      confirmLabel={pending ? (CONFIRM_TITLE[pending.action] ?? "Confirm") : "Confirm"}
      cancelLabel="Keep as is"
      isBusy={busyId !== null}
      busyLabel="Saving..."
    />
    </div>
  );
}
