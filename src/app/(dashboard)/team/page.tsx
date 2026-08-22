import { redirect } from "next/navigation";
import InvitePanel from "@/components/team/InvitePanel";
import InvitationsTable from "@/components/team/InvitationsTable";
import TeamMembers from "@/components/team/TeamMembers";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import { PermissionError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { getTeamOverview, type TeamOverview } from "@/lib/team";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// Team — Stage 6. The people in this organisation, and the invitations out.
//
// `team:view` gates the page; `team:invite`, `team:approve` and `team:manage`
// gate the controls on it. All four are enforced in @/lib/team and
// @/lib/invitations rather than by hiding anything, so reaching this URL
// directly gets the same refusal the API gives.
//
// Roles are shown but not editable here. `user_roles` has two writers and this
// screen is neither — see the note at the top of @/lib/team.

export default async function TeamPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.team);
  if (locked) {
    return <ModuleLocked title="Team" reason={locked} />;
  }

  let overview: TeamOverview | null = null;
  try {
    overview = await getTeamOverview(actor);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!overview) {
    return (
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
        <PageHeader title="Team" />
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
          Your role cannot view the team. Ask the account owner if you need
          access.
        </div>
      </section>
    );
  }

  const activeCount = overview.members.filter(
    (member) => member.membershipStatus === "ACTIVE",
  ).length;
  const outstanding = overview.invitations.filter(
    (invitation) => invitation.isOutstanding,
  ).length;

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-8">
      <InvitePanel
        canInvite={overview.canInvite}
        roles={overview.roles}
        clinics={overview.clinics}
        meta={
          <>
            <Count>{activeCount}</Count> active
            {overview.members.length !== activeCount && (
              <>
                {" of "}
                <Count>{overview.members.length}</Count>
              </>
            )}
            {outstanding > 0 && (
              <>
                {" · "}
                <Count>{outstanding}</Count> invitation
                {outstanding === 1 ? "" : "s"} outstanding
              </>
            )}
          </>
        }
      />

      <TeamMembers
        members={overview.members}
        canApprove={overview.canApprove}
        canManage={overview.canManage}
      />

      <InvitationsTable
        invitations={overview.invitations}
        canInvite={overview.canInvite}
      />
    </section>
  );
}
