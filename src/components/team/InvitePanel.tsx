"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { GrantableRole } from "@/lib/roles";

/**
 * Invite someone to the account — Stage 6.
 *
 * Collapsed by default so the team list stays the focus. It owns the page
 * header, because the button belongs beside the title while the form it opens
 * needs the column width below it — the same arrangement as AddClinicPanel.
 *
 * ONLY ROLES THE SERVER WOULD ACCEPT ARE OFFERED. The list comes from
 * `listGrantableRoles`, which applies the same rule the write path applies:
 * you cannot hand out reach you do not hold. Offering a role that would be
 * refused on submit is how staff learn to distrust the screen.
 *
 * The clinic choice narrows the role to one site, exactly as a clinic-scoped
 * role assignment does. Left blank, the invitation is account-wide.
 */

interface InvitePanelProps {
  canInvite: boolean;
  roles: GrantableRole[];
  clinics: { id: string; name: string }[];
  meta: ReactNode;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InvitePanel({
  canInvite,
  roles,
  clinics,
  meta,
}: InvitePanelProps) {
  const router = useRouter();
  const showToast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [touched, setTouched] = useState({ email: false, roleId: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Mirrors the zod rules in src/lib/invitations.ts. The server stays
  // authoritative; this only saves a round trip.
  const emailError = !EMAIL_PATTERN.test(email.trim())
    ? "Enter a valid email address."
    : undefined;
  const roleError = roleId === "" ? "Choose a role." : undefined;
  const hasErrors = Boolean(emailError || roleError);

  function close() {
    setIsOpen(false);
    setEmail("");
    setRoleId("");
    setClinicId("");
    setTouched({ email: false, roleId: false });
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (hasErrors) {
      setTouched({ email: true, roleId: true });
      return;
    }
    if (isSending) {
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          roleId,
          clinicId: clinicId || undefined,
        }),
      });

      const body: {
        success?: boolean;
        error?: string;
        data?: { supersededPrevious?: boolean };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setFormError(body.error ?? "Could not send the invitation. Try again.");
        return;
      }

      showToast({
        tone: "ok",
        title: `Invitation sent to ${email.trim()}.`,
        detail: body.data?.supersededPrevious
          ? "Their earlier invitation link no longer works."
          : "It expires in 7 days and can be used once.",
      });
      close();
      router.refresh();
    } catch {
      setFormError(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Team"
        meta={meta}
        actions={
          canInvite &&
          !isOpen && (
            <Button variant="commit" onClick={() => setIsOpen(true)}>
              <UserPlus aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              Invite Member
            </Button>
          )
        }
      />

      {isOpen && (
        <Panel
          title="Invite someone to this account"
          description="They set their own password from the emailed link. Nothing is created until they do."
        >
          <form onSubmit={handleSubmit} noValidate>
            {formError && (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
              >
                {formError}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                id="invite-email"
                name="email"
                label="Email"
                type="email"
                autoComplete="off"
                placeholder="name@clinic.com"
                value={email}
                error={touched.email ? emailError : undefined}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              />

              <Select
                id="invite-role"
                name="roleId"
                label="Role"
                value={roleId}
                error={touched.roleId ? roleError : undefined}
                onChange={(event) => setRoleId(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, roleId: true }))}
              >
                <option value="">Choose a role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>

              <Select
                id="invite-clinic"
                name="clinicId"
                label="Clinic"
                hint="Leave blank for the whole account."
                value={clinicId}
                onChange={(event) => setClinicId(event.target.value)}
              >
                <option value="">All clinics</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="commit"
                isBusy={isSending}
                busyLabel="Sending..."
              >
                Send Invitation
              </Button>
              <Button variant="quiet" onClick={close} disabled={isSending}>
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}
