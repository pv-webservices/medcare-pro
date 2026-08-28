import Link from "next/link";
import { Clock, PauseCircle, ShieldX } from "lucide-react";
import AuthCard from "@/components/auth/AuthCard";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthLayout from "@/components/auth/AuthLayout";
import VerificationBadge, {
  type VerificationTone,
} from "@/components/auth/VerificationBadge";
import { authLinkClasses } from "@/components/auth/AuthButton";

/**
 * The applicant's status screen — Stage 3 item 4.
 *
 * Reached from two places: the verification link, once the address is confirmed
 * but the application is still under review, and the login screen, when a
 * correct password is refused because of the organisation's state.
 *
 * IT READS NOTHING. No session, no database, no email address in the URL — the
 * page is driven entirely by a `status` parameter and renders fixed copy. That
 * is deliberate: the page is public, so anything it looked up would be
 * lookup-able by anyone. The caller has already been authenticated (login) or
 * has already proven control of the address (verification link) before being
 * sent here; this page just says what happens next.
 */

type PendingStatus = "pending" | "rejected" | "suspended";

const COPY: Record<
  PendingStatus,
  { icon: typeof Clock; title: string; body: string; tone: VerificationTone }
> = {
  pending: {
    icon: Clock,
    title: "Your registration is under review",
    body: "Thanks — we have your details. A member of the MedCare Pro team reviews every clinic before it goes live. You will get an email as soon as a decision is made, and you can sign in from that point.",
    tone: "warning",
  },
  rejected: {
    icon: ShieldX,
    title: "Your registration was not approved",
    body: "We were not able to approve this clinic. The reason was sent to the email address you registered with. If you think this was a mistake, reply to that email.",
    tone: "error",
  },
  suspended: {
    icon: PauseCircle,
    title: "This account is suspended",
    body: "Access for this clinic is currently suspended. The reason was sent to the email address on the account. Reply to that email to sort it out.",
    tone: "warning",
  },
};

function parseStatus(value: string | undefined): PendingStatus {
  return value === "rejected" || value === "suspended" ? value : "pending";
}

interface PageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PendingApprovalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = parseStatus(raw);
  const copy = COPY[status];
  const Icon = copy.icon;

  return (
    <AuthLayout>
      <AuthCard>
        <AuthHeader
          badge={
            <VerificationBadge tone={copy.tone}>
              <Icon className="h-6 w-6" strokeWidth={1.9} />
            </VerificationBadge>
          }
          title={copy.title}
          description={copy.body}
        />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px]">
          <Link href="/login" className={authLinkClasses}>
            Back to sign in
          </Link>
          {status === "rejected" && (
            <Link
              href="/signup"
              className="rounded font-semibold text-auth-muted transition-colors duration-150 hover:text-auth-ink"
            >
              Register a different clinic
            </Link>
          )}
        </div>
      </AuthCard>

      <AuthFooter>
        Questions about a decision? Reply to the email we sent you.
      </AuthFooter>
    </AuthLayout>
  );
}
