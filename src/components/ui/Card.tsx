import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A white surface on the page canvas: hairline, 18px radius, low shadow.
 *
 * `Panel` is the version with a title bar; use that when the container has to
 * announce itself. This is the plain box.
 *
 * CARDS ARE NOT FOR EVERYTHING. They are for KPIs, summaries, analytics, grouped
 * settings and contextual information — things that are genuinely one object. A
 * long data list is not one object: it goes in a `Table`, which is its own
 * surface. Nesting a card inside a card inside a card is the failure mode this
 * note exists to prevent; if the inner thing needs separating, use space or a
 * hairline, not a third surface.
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
        "rounded-3xl border border-line bg-canvas shadow-card",
        isInteractive && "lift hover:border-line-strong",
        !isFlush && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
