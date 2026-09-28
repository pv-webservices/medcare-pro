import { notFound, redirect } from "next/navigation";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { ScopeError, PermissionError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";

export async function billingPage<T>(load: (actor: ActorContext) => Promise<T>): Promise<T> {
  try { return await load(await requireActor()); }
  catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login?ended=1");
    if (error instanceof ScopeError || error instanceof PermissionError || error instanceof FeatureError) notFound();
    throw error;
  }
}
