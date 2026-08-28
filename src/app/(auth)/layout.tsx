import type { ReactNode } from "react";
import type { Metadata } from "next";

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

export default function AuthRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
