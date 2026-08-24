import { redirect } from "next/navigation";
import NotificationList from "@/components/notifications/NotificationList";
import StatusFilter, {
  type NotificationStatus,
} from "@/components/notifications/StatusFilter";
import PageHeader from "@/components/ui/PageHeader";
import {
  listNotificationsForActor,
  type NotificationFeed,
} from "@/lib/notifications";
import { PermissionError } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

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

  const locked = await moduleLock(actor, MODULE_FEATURES.notifications);
  if (locked) {
    return <ModuleLocked title="Notifications" reason={locked} />;
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
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
        <PageHeader title="Notifications" />
        <div className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
          Your role cannot view notifications. Ask an admin or the account owner
          if you need access.
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <PageHeader
        title="Notifications"
        meta={
          <div className="flex flex-col gap-1">
            <span>Changes to patients, doctors and clinics.</span>
            <span>Marking an item read clears it for everyone on this account.</span>
          </div>
        }
      />

      <div className="pt-2">
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
