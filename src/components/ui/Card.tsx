import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A raised surface on the page canvas. No header, no padding opinions — this
 * is the box. `Panel` is the version with a title bar; use that when the
 * container needs to announce itself.
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the inner padding, for a card whose child is a full-bleed table. */
  isFlush?: boolean;
  children: ReactNode;
}

export default function Card({
  isFlush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        "rounded-lg border border-line bg-surface shadow-card",
        !isFlush && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
