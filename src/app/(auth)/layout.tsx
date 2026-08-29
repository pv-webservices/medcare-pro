import type { ReactNode } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";

/**
 * Route-group layout for the unauthenticated screens.
 *
 * IT DELIBERATELY DRAWS NOTHING. The two-column shell lives in
 * components/auth/AuthLayout instead, so each page can choose its own measure -
 * the signup form is wider than the sign-in form - and so a server-rendered
 * outcome page can compose it without crossing a client boundary. This file
 * exists for the metadata.
 */

export const metadata: Metadata = {
  title: {
    default: "MedCare Pro",
    template: "%s | MedCare Pro",
  },
};

export default async function AuthRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Authentication HTML must never outlive the hashed assets from its build.
  // Waiting for the incoming request prevents the hosting CDN from retaining a
  // statically generated page whose CSS and JavaScript may be removed later.
  await connection();

  return children;
}
