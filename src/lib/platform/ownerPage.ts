import { notFound, redirect } from "next/navigation";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { PlatformAuthorizationError } from "@/lib/platform/context";
import type { PlatformActorContext } from "@/lib/platform/context";

/**
 * The gate every page under `/owner` runs — Stage 2's rule, factored out in
 * Stage 3 once there was more than one page to run it.
 *
 * A signed-in non-Owner gets 404, not 403. 403 would confirm that the platform
 * surface exists and that they simply lack the role — worth nothing to a
 * legitimate user and a great deal to someone probing. Only "no session at all"
 * redirects to the login screen, and that leaks nothing: /owner/login renders
 * for anyone who asks for it.
 *
 * Server components only — `redirect` and `notFound` throw control-flow
 * exceptions that Next unwinds during render.
 */
export async function requireOwnerPage(): Promise<PlatformActorContext> {
  try {
    return await requirePlatformOwner();
  } catch (error: unknown) {
    if (error instanceof PlatformAuthorizationError) {
      if (error.reason === "no-session") {
        redirect("/owner/login");
      }
      notFound();
    }
    throw error;
  }
}
