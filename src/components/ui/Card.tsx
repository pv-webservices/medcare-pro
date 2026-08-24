import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A raised surface on the page canvas. No header, no padding opinions — this is
 * the box. `Panel` is the version with a title bar; use that when the container
 * needs to announce itself.
 *
 * THE CARD IS THE SAME COLOUR AS THE PAGE. It has no border and no fill of its
 * own; the paired shadow is the entire separation. Adding `bg-white` or a
 * border at a call site does not make the card clearer, it drops a different
 * design language into the middle of this one.
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the inner padding, for a card whose child is a full-bleed table. */
  isFlush?: boolean;
  /**
   * Lifts on hover. For a card that is itself a link or a drop target — never
   * for a static container, where motion under the pointer is only noise.
   */
  isInteractive?: boolean;
  children: ReactNode;
}

export default function Card({
  isFlush = false,
  isInteractive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        "rounded-3xl bg-canvas shadow-neu-raised",
        isInteractive && "neu-lift",
        !isFlush && "p-6",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
