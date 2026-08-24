import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

/*
 * ONE TYPEFACE, THE FULL WEIGHT RANGE.
 *
 * Plus Jakarta Sans carries every role. The previous pairing split headings
 * (Anek Latin) from body and figures (IBM Plex Sans); the neumorphic system
 * does that separation with weight instead — 800 for a page greeting and a KPI
 * number, 400 for a caption — because on a surface this soft, a second
 * typeface reads as a second design rather than a second voice.
 *
 * It keeps what the pairing was chosen for: true tabular figures, so rupee
 * amounts and patient counts align down a column, and open enough shapes to
 * keep 1 / l / I distinct in a ten-digit mobile number.
 *
 * 800 is loaded because the design genuinely uses it (greeting, KPI, wordmark).
 * Adding a weight that no rule calls for is the usual way a font budget grows.
 */

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
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
      suppressHydrationWarning
      className={`h-full antialiased ${jakarta.variable}`}
    >
      <body className="min-h-full font-sans">
        <ThemeProvider attribute="data-theme" defaultTheme="light">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
