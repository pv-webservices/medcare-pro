import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * The empty state for every list.
 *
 * A primitive rather than markup repeated per screen, because the ground rule —
 * an empty screen names what is missing and offers the next action — only holds
 * if it is the same object everywhere.
 *
 * NO ILLUSTRATION. A picture of an empty box tells a busy front desk nothing it
 * did not already know, and a 400px drawing pushes the action that fixes the
 * emptiness below the fold. One small icon tile, a heading, a sentence.
 *
 * The distinction that matters in the copy: "nothing exists yet" and "nothing
 * matches your filters" are different problems with different next steps, and
 * the call site is expected to say which one this is.
 */

interface EmptyStateProps {
  /** What is not here, in the product's vocabulary. "No registrations yet." */
  title: string;
  /** How to change that, in one sentence. */
  guidance: string;
  /** A Lucide icon. Defaults to an inbox where the module has no better mark. */
  icon?: ReactNode;
  /** The action that fixes it, if the reader is allowed to take it. */
  action?: ReactNode;
  /**
   * Drops the surface, for an empty state that already sits inside a card or a
   * table body and would otherwise be a box inside a box.
   */
  isBare?: boolean;
  className?: string;
}

export default function EmptyState({
  title,
  guidance,
  icon,
  action,
  isBare = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "px-6 py-12 text-center",
        !isBare && "rounded-2xl border border-line bg-canvas shadow-card",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-canvas-deep text-muted"
      >
        {icon ?? <Inbox className="h-5 w-5" strokeWidth={2} />}
      </span>

      <p className="text-section font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-body text-muted">{guidance}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
