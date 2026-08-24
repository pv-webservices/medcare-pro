import type { ReactNode } from "react";

/**
 * The empty state for every list.
 *
 * It is a primitive rather than markup repeated per screen because the ground
 * rule — an empty screen names what is missing and offers the next action —
 * only holds if it is the same object everywhere. No illustration: a picture of
 * an empty box tells a busy front desk nothing it did not already know.
 *
 * Rendered as a WELL rather than a raised card, which is the one place this
 * design inverts the usual reading. An empty list is an absence, and an inset
 * surface is the shape in this vocabulary that means "nothing has been put here
 * yet". The dashed border the flat system used to carry is redundant once the
 * surface itself says it.
 */

interface EmptyStateProps {
  /** What is not here, in the words the PRD uses. "No registrations today." */
  title: string;
  /** How to change that, in one sentence. */
  guidance: string;
  /** The action that fixes it, if the reader is allowed to take it. */
  action?: ReactNode;
}

export default function EmptyState({ title, guidance, action }: EmptyStateProps) {
  return (
    <div className="rounded-3xl bg-canvas px-6 py-14 text-center shadow-neu-inset">
      <p className="text-section font-bold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-body font-medium text-muted">
        {guidance}
      </p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
