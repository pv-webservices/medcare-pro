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
    <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-xl font-bold text-slate-900">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{guidance}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
