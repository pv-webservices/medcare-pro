import Link from "next/link";
import { ShieldX } from "lucide-react";
import AcceptInvitationForm from "@/components/auth/AcceptInvitationForm";
import { authButtonClasses } from "@/components/auth/AuthButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthLayout from "@/components/auth/AuthLayout";
import VerificationBadge from "@/components/auth/VerificationBadge";
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
      <AuthLayout>
        <AuthCard>
          <AuthHeader
            badge={
              <VerificationBadge tone="error">
                <ShieldX className="h-6 w-6" strokeWidth={1.9} />
              </VerificationBadge>
            }
            title="This invitation cannot be used"
            /*
              The message comes from a fixed set in lib/invitationPolicy.ts,
              never from the URL — nothing the visitor typed is echoed back.
            */
            description={result.message}
          />

          <Link href="/login" className={authButtonClasses("secondary")}>
            Go to sign in
          </Link>
        </AuthCard>
      </AuthLayout>
    );
  }

  const { preview } = result;

  return (
    <AuthLayout>
      <AuthCard>
        <AuthHeader
          title={`Join ${preview.businessName}`}
          description={
            <>
              {preview.invitedByName
                ? `${preview.invitedByName} invited you as `
                : "You have been invited as "}
              <span className="font-semibold text-auth-ink">
                {preview.roleName}
              </span>
              {preview.clinicName
                ? ` at ${preview.clinicName}`
                : " across the whole account"}
              . Choose a password to finish setting up your login.
            </>
          }
        />

        <AcceptInvitationForm token={token} email={preview.email} />
      </AuthCard>
    </AuthLayout>
  );
}
