import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A titled surface: a `Card` whose contents need announcing — an add form, a
 * filter block, a report section, a settings group.
 *
 * The header is separated from the body by SPACE by default. `hasDivider` draws
 * a hairline instead, which is right when the body is a table or a list that
 * starts hard against the header and would otherwise float.
 *
 * The title is 17px/600 over a 13px muted line. That pairing is the section
 * signature used on every screen; keeping it in the primitive is what stops
 * eleven modules from each inventing their own.
 */

interface PanelProps {
  title: string;
  /** One line under the title. Say what this section is for, not what it is. */
  description?: string;
  /** Controls that belong to the panel as a whole, right-aligned in the bar. */
  actions?: ReactNode;
  /** Renders the title as an `h2` by default; pass 3 inside a nested section. */
  headingLevel?: 2 | 3;
  /** Drops the body padding — for a panel whose child is a full-bleed table. */
  isFlush?: boolean;
  /** A hairline between header and body. Use with `isFlush` for tables. */
  hasDivider?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Panel({
  title,
  description,
  actions,
  headingLevel = 2,
  isFlush = false,
  hasDivider = false,
  className,
  children,
}: PanelProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      aria-label={title}
      className={cx(
        "overflow-hidden rounded-2xl border border-line bg-canvas shadow-card dashboard-card-hover",
        className,
      )}
    >
      <div
        className={cx(
          "flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5",
          hasDivider ? "border-b border-line pb-4" : "pb-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <Heading className="text-section font-semibold text-ink">
            {title}
          </Heading>
          {description && (
            <p className="mt-1 text-label text-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      <div className={cx(isFlush ? "" : "px-4 pb-4 sm:px-5 sm:pb-5")}>{children}</div>
    </section>
  );
}
