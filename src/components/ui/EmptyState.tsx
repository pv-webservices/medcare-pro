import type { ReactNode } from "react";

/**
 * The empty state for every list.
 *
 * It is a primitive rather than markup repeated per screen because the ground
 * rule — an empty screen names what is missing and offers the next action —
 * only holds if it is the same object everywhere. No illustration: a picture
 * of an empty box tells a busy front desk nothing it did not already know.
 */

interface EmptyStateProps {
  /** What is not here, in the PRD's words. "No registrations logged today." */
  title: string;
  /** How to change that, in one sentence. */
  guidance: string;
  /** The action that fixes it, if the reader is allowed to take it. */
  action?: ReactNode;
}

export default function EmptyState({ title, guidance, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="font-display text-section font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-body text-muted">{guidance}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
