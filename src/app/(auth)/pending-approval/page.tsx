import Link from "next/link";
import { Clock, Plus, ShieldX, PauseCircle } from "lucide-react";

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
  { icon: typeof Clock; title: string; body: string; tone: string }
> = {
  pending: {
    icon: Clock,
    title: "Your registration is under review",
    body: "Thanks — we have your details. A member of the MEDCARE PRO team reviews every clinic before it goes live. You will get an email as soon as a decision is made, and you can sign in from that point.",
    tone: "bg-warn-bg text-warn-ink",
  },
  rejected: {
    icon: ShieldX,
    title: "Your registration was not approved",
    body: "We were not able to approve this clinic. The reason was sent to the email address you registered with. If you think this was a mistake, reply to that email.",
    tone: "bg-alert-bg text-alert-ink",
  },
  suspended: {
    icon: PauseCircle,
    title: "This account is suspended",
    body: "Access for this clinic is currently suspended. The reason was sent to the email address on the account. Reply to that email to sort it out.",
    tone: "bg-orange-50 text-orange-600",
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
    <div className="flex min-h-screen items-center justify-center bg-canvas-deep p-4 sm:p-8">
      <div className="w-full max-w-md rounded-[2rem] bg-canvas p-8 shadow-neu-float sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Plus className="h-6 w-6 stroke-[3]" />
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

        <div
          className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${copy.tone}`}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {copy.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{copy.body}</p>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link
            href="/login"
            className="font-semibold text-accent hover:text-accent"
          >
            Back to sign in
          </Link>
          {status === "rejected" && (
            <Link
              href="/signup"
              className="font-semibold text-muted hover:text-ink"
            >
              Register a different clinic
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
