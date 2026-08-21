import { redirect } from "next/navigation";
import OwnerLoginForm from "@/components/owner/OwnerLoginForm";
import { getPlatformOwner } from "@/lib/platform/auth";

/**
 * Platform Owner sign-in — Stage 2.
 *
 * Separate from `/login` so the two surfaces never share a screen, but NOT a
 * separate credential system: it drives the same Auth.js Credentials provider.
 * Signing in here proves who you are; it does not make you an Owner. A clinic
 * user who submits this form gets an ordinary session and a 404 at
 * `/owner/dashboard`, because that page asks the database, not the form.
 *
 * There is no Owner *registration* route, here or anywhere — Owners exist only
 * via the create-owner command (scripts/create-owner.mts).
 */
export default async function OwnerLoginPage() {
  // An Owner who is already signed in has no use for this screen. Anyone else,
  // signed in or not, sees the form: bouncing a clinic user to their dashboard
  // from here would confirm that /owner is a real surface.
  const owner = await getPlatformOwner();
  if (owner) {
    redirect("/owner/dashboard");
  }

  return <OwnerLoginForm />;
}
