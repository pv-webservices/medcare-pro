import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Anek_Latin, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/*
 * Two type roles, no more — see .claude/skills/admin-dashboard-ui.
 *
 * Anek Latin (Ek Type, Mumbai) carries headings. Its siblings cover Devanagari
 * and the South Indian scripts, so this UI can grow Hindi or Marathi labels
 * later without changing typeface.
 *
 * IBM Plex Sans carries everything else, and every number without exception:
 * it was drawn for dense enterprise interfaces, has true tabular figures for
 * rupee amounts and patient counts, and keeps 1 / l / I distinct — which is
 * what a ten-digit mobile number needs.
 */

const anek = Anek_Latin({
  subsets: ["latin"],
  variable: "--font-anek",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MEDCARE PRO",
  description: "Multi-clinic registration, revenue and patient messaging.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${anek.variable} ${plex.variable}`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
