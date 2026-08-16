import { redirect } from "next/navigation";
import NotificationList from "@/components/notifications/NotificationList";
import StatusFilter, {
  type NotificationStatus,
} from "@/components/notifications/StatusFilter";
import {
  listNotificationsForActor,
  type NotificationFeed,
} from "@/lib/notifications";
import { PermissionError } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Notifications — PRD §6.7 (FR-7.1, FR-7.2). Owner/Admin only.
//
// `notification:read` is enforced in @/lib/notifications, not by hiding this
// page: Staff do not hold it, and reaching this URL directly gets them the same
// refusal the API gives.
//
// The clinic scope comes from the sidebar switcher, as in every other module
// (FR-2.3), so there is no second clinic control here to disagree with it.

interface NotificationsPageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const params = await searchParams;
  const requested = Array.isArray(params.status) ? params.status[0] : params.status;
  // An unknown ?status= falls back to "all" rather than erroring: a stale
  // bookmark should show the feed, not a stack trace.
  const status: NotificationStatus = requested === "unread" ? "unread" : "all";

  const selectedClinicId = await resolveSelectedClinicId(actor);

  let feed: NotificationFeed | null = null;
  try {
    feed = await listNotificationsForActor(actor, {
      status,
      clinicId: selectedClinicId ?? undefined,
    });
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!feed) {
    return (
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Notifications</h1>
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot view notifications. Ask an admin or the account owner
          if you need access.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Changes to patients, doctors and clinics.{" "}
          {/* Stated up front — one account, one read flag (PRD §7). */}
          Marking an item read clears it for everyone on this account.
        </p>
      </div>

      <div className="mb-6">
        <StatusFilter selected={status} unreadCount={feed.unreadCount} />
      </div>

      <NotificationList
        items={feed.items.map((item) => ({
          id: item.id,
          typeLabel: item.typeLabel,
          message: item.message,
          clinicName: item.clinicName,
          href: item.href,
          read: item.read,
          createdAt: item.createdAt.toISOString(),
        }))}
        unreadCount={feed.unreadCount}
        canMark
      />
    </section>
  );
}
