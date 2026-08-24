import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A titled container: a `Card` whose contents need announcing — an add form, a
 * filter block, a report section.
 *
 * The header is separated by SPACE, not by a rule. A border drawn across a soft
 * surface cuts it in half and the panel stops reading as one raised object, so
 * the title block simply sits above the content with room around it.
 *
 * The title is 17px/700 against a 13px/500 muted subtitle. That pairing is the
 * section-header signature used on every screen; keeping it in the primitive is
 * what stops eleven modules from each inventing their own.
 */

interface PanelProps {
  title: string;
  /** One line under the title. Say what this section is for, not what it is. */
  description?: string;
  /** Controls that belong to the panel as a whole, right-aligned in the bar. */
  actions?: ReactNode;
  /** Renders the title as an `h2` by default; pass 3 inside a nested section. */
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}

export default function Panel({
  title,
  description,
  actions,
  headingLevel = 2,
  className,
  children,
}: PanelProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      aria-label={title}
      className={cx("rounded-3xl bg-canvas p-6 shadow-neu-raised", className)}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Heading className="text-section font-bold text-ink">{title}</Heading>
          {description && (
            <p className="mt-1 text-label font-medium text-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-3">{actions}</div>
        )}
      </div>

      {children}
    </section>
  );
}
