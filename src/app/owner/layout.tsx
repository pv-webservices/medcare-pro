import type { ReactNode } from "react";
import { resolveLiveSession } from "@/lib/session";
import { evaluatePlatformAccess, OWNER_PLATFORM_ROLE } from "@/lib/platform/context";
import { prisma } from "@/lib/prisma";
import OwnerShell from "@/components/owner/OwnerShell";

interface OwnerLayoutProps {
  children: ReactNode;
}

/**
 * Shell for the platform surface — Stage 2.
 *
 * Scoping the dark theme to this subtree means the owner panel is the
 * same design system in its other mode: one set of tokens, one depth
 * vocabulary.
 */
export default async function OwnerLayout({ children }: OwnerLayoutProps) {
  const session = await resolveLiveSession();
  const context = session?.context;

  const isOwner =
    context !== null &&
    context !== undefined &&
    evaluatePlatformAccess({
      sessionValid: true,
      platformRole: context.user.platformRole ?? null,
      accountStatus: context.user.accountStatus ?? "PENDING",
      required: OWNER_PLATFORM_ROLE,
    }).allowed;

  if (!isOwner || !context) {
    return (
      <main data-theme="dark" className="min-h-screen bg-[#070d1d] text-ink">
        {children}
      </main>
    );
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: context.user.id },
    select: { name: true, email: true },
  });

  return (
    <div data-theme="dark" className="min-h-screen bg-[#060b17] text-white">
      <OwnerShell
        user={{
          name: currentUser?.name || "Superadmin",
          email: currentUser?.email || null,
          platformRole: "Superadmin",
        }}
      >
        {children}
      </OwnerShell>
    </div>
  );
}
