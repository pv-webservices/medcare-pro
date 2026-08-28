import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The badge that opens an outcome screen: check your inbox, link expired,
 * registration under review.
 *
 * A 56px TILE, NOT AN ILLUSTRATION. These screens are read at a moment of mild
 * anxiety - did it send, is my account broken - and the fastest reassurance is
 * a legible icon and a sentence, not a drawing. The tone tints the tile and
 * nothing else on the page, so the colour is a signal rather than a mood.
 *
 * The icon is decorative: the heading beside it says the same thing in words,
 * which is what a screen reader announces.
 */

export type VerificationTone = "pending" | "success" | "warning" | "error";

const TONES: Record<VerificationTone, string> = {
  pending: "bg-auth-primary-soft text-auth-primary-soft-ink",
  success: "bg-auth-ok-bg text-auth-ok-ink",
  warning: "bg-auth-warn-bg text-auth-warn-ink",
  error: "bg-auth-alert-bg text-auth-alert-ink",
};

export default function VerificationBadge({
  tone = "pending",
  children,
  className,
}: {
  tone?: VerificationTone;
  /** A Lucide icon, sized by the caller at 24px. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-14 w-14 items-center justify-center rounded-[18px]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
