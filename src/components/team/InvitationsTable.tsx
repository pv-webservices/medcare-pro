"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import type { InvitationSummary } from "@/lib/invitations";

/**
 * Invitations that have not been accepted — Stage 6.
 *
 * Accepted ones are absent by design: once spent, that person is a member and
 * belongs in the members table, not in a list of outstanding paperwork.
 *
 * Only an OUTSTANDING invitation offers Revoke. A revoked or expired row still
 * shows, because "I sent that and it lapsed" is the question this list gets
 * asked, but there is nothing left to withdraw.
 *
 * THE LINK ITSELF IS NEVER SHOWN HERE. The raw token exists only in the email;
 * the database holds a hash. Re-inviting the same address issues a new token
 * and kills the old one, which is what "resend" means on this screen.
 */

interface InvitationsTableProps {
  invitations: InvitationSummary[];
  canInvite: boolean;
}

const STATUS_TONE: Record<InvitationSummary["displayStatus"], StatusTone> = {
  Pending: "warn",
  Opened: "warn",
  Expired: "neutral",
  Revoked: "neutral",
  Accepted: "ok",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InvitationsTable({
  invitations,
  canInvite,
}: InvitationsTableProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (invitations.length === 0) {
    return null;
  }

  async function revoke(invitation: InvitationSummary) {
    if (
      !window.confirm(
        `Revoke the invitation to ${invitation.email}? Their link will stop working immediately.`,
      )
    ) {
      return;
    }
    if (busyId) {
      return;
    }

    setBusyId(invitation.id);
    try {
      const response = await fetch("/api/team/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        showToast({
          tone: "alert",
          title: body.error ?? "Could not revoke the invitation. Try again.",
        });
        return;
      }

      showToast({ tone: "ok", title: `Invitation to ${invitation.email} revoked.` });
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

  return (
    <Panel
      title="Invitations"
      description="Sent but not yet accepted. Inviting the same address again replaces the link."
      className="overflow-visible"
    >
      <Table caption="Invitations sent from this organisation">
        <THead>
          <TH>Email</TH>
          <TH>Role</TH>
          <TH>Sent by</TH>
          <TH>Expires</TH>
          <TH>Status</TH>
          <TH align="end">Actions</TH>
        </THead>
        <TBody>
          {invitations.map((invitation) => (
            <TR key={invitation.id}>
              <TD>
                <span className="font-medium text-slate-900">{invitation.email}</span>
              </TD>
              <TD>
                {invitation.roleName}
                {invitation.clinicName && (
                  <span className="block text-xs text-slate-500">
                    {invitation.clinicName}
                  </span>
                )}
              </TD>
              <TD>{invitation.invitedByName ?? "—"}</TD>
              <TD className="tabular-nums">{formatDate(invitation.expiresAt)}</TD>
              <TD>
                <StatusPill tone={STATUS_TONE[invitation.displayStatus]}>
                  {invitation.displayStatus}
                </StatusPill>
              </TD>
              <TD align="end">
                {invitation.isOutstanding && canInvite ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === invitation.id}
                    onClick={() => revoke(invitation)}
                  >
                    Revoke
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
