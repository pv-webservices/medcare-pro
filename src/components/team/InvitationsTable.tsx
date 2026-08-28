"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ConfirmDialog } from "@/components/ui/Modal";
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
  /**
   * Revoking kills a link that is already in somebody's inbox, so it asks
   * first — in a dialog rather than a browser confirm(), which cannot be styled,
   * cannot be read in the page's own voice, and on a shared tablet looks like
   * the browser talking rather than the product.
   */
  const [pendingRevoke, setPendingRevoke] = useState<InvitationSummary | null>(
    null,
  );

  if (invitations.length === 0) {
    return null;
  }

  async function revoke(invitation: InvitationSummary) {
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
                <span className="font-medium text-ink">{invitation.email}</span>
              </TD>
              <TD>
                {invitation.roleName}
                {invitation.clinicName && (
                  <span className="block text-meta text-muted">
                    {invitation.clinicName}
                  </span>
                )}
              </TD>
              <TD>{invitation.invitedByName ?? "—"}</TD>
              <TD className="tnum">{formatDate(invitation.expiresAt)}</TD>
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
                    onClick={() => setPendingRevoke(invitation)}
                  >
                    Revoke
                  </Button>
                ) : (
                  <span className="text-meta text-faint">—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <ConfirmDialog
        isOpen={pendingRevoke !== null}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const invitation = pendingRevoke;
          setPendingRevoke(null);
          if (invitation) {
            void revoke(invitation);
          }
        }}
        title="Revoke this invitation?"
        body={
          pendingRevoke
            ? `The link sent to ${pendingRevoke.email} stops working immediately. You can invite the same address again afterwards.`
            : ""
        }
        confirmLabel="Revoke invitation"
        cancelLabel="Keep it"
        isBusy={busyId !== null}
        busyLabel="Revoking..."
      />
    </Panel>
  );
}
