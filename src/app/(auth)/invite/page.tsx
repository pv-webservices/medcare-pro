import Link from "next/link";
import { Plus, ShieldX } from "lucide-react";
import AcceptInvitationForm from "@/components/auth/AcceptInvitationForm";
import { loadInvitationPreview } from "@/lib/invitations";

/**
 * Accepting an invitation — Stage 6.
 *
 * PUBLIC, and it has to be: the visitor has no login yet, which is the whole
 * point. The token in the query string is the only credential, and it is passed
 * straight back to the accept endpoint rather than being trusted here — this
 * page decides what to render, never what is allowed.
 *
 * NOT IN THE MIDDLEWARE'S PUBLIC_AUTH_PATHS, deliberately. Those paths bounce a
 * signed-in visitor to /dashboard, which for an invitation link would silently
 * swallow it. Someone already signed in who follows a link sees the page and is
 * told to sign out first — one login belongs to one organisation.
 *
 * FOLLOWING THE LINK COMPLETES NOTHING. It stamps `openedAt` and renders a
 * form; a name and a password are still required. That is what makes the mail
 * safe to send to an inbox whose scanner may fetch every URL it sees.
 */

interface PageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readToken(params: Record<string, string | string[] | undefined>): string {
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  return typeof raw === "string" ? raw : "";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-deep p-4 sm:p-8">
      <div className="w-full max-w-md rounded-[2rem] bg-canvas p-8 shadow-neu-float sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Plus className="h-6 w-6 stroke-[3]" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xl font-bold leading-none tracking-tight text-ink">
              Medicare Pro
            </div>
            <div className="mt-0.5 text-xs font-medium text-muted">
              Smart Clinic Management
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function AcceptInvitationPage({ searchParams }: PageProps) {
  const token = readToken(await searchParams);
  const result = token
    ? await loadInvitationPreview(token)
    : ({
        status: "refused",
        refusal: "not-found",
        message:
          "This invitation link is not valid. Ask your administrator to send you a new one.",
      } as const);

  if (result.status === "refused") {
    return (
      <Shell>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-alert-bg text-alert-ink">
          <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-ink">
          This invitation cannot be used
        </h1>
        {/*
          The message comes from a fixed set in lib/invitationPolicy.ts, never
          from the URL — nothing the visitor typed is echoed back into the page.
        */}
        <p className="mt-3 text-sm text-muted">{result.message}</p>
        <Link
          href="/login"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink hover:bg-accent-strong"
        >
          Go to sign in
        </Link>
      </Shell>
    );
  }

  const { preview } = result;

  return (
    <Shell>
      <h1 className="text-xl font-bold tracking-tight text-ink">
        Join {preview.businessName}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {preview.invitedByName
          ? `${preview.invitedByName} invited you as `
          : "You have been invited as"}
        <span className="font-semibold text-ink">{preview.roleName}</span>
        {preview.clinicName ? ` at ${preview.clinicName}` : "across the whole account"}
        . Choose a password to finish setting up your login.
      </p>

      <div className="mt-6">
        <AcceptInvitationForm token={token} email={preview.email} />
      </div>
    </Shell>
  );
}
