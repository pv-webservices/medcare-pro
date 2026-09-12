import { notFound, redirect } from "next/navigation";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { ScopeError, PermissionError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";

/** Shared page protection; unknown/out-of-scope clinical ids render the same 404. */
export async function prescriptionPage<T>(
  load: (actor: Awaited<ReturnType<typeof requireActor>>) => Promise<T>,
): Promise<T> {
  try {
    return await load(await requireActor());
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login?ended=1");
    if (
      error instanceof ScopeError ||
      error instanceof PermissionError ||
      error instanceof FeatureError
    )
      notFound();
    throw error;
  }
}
