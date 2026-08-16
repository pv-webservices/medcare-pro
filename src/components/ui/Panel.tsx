import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A titled container: a `Card` whose contents need announcing — an add form,
 * a filter block, a report section.
 *
 * The title is the one place besides the page heading where the display face
 * appears. Everything inside is body type.
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
      className={cx(
        "rounded-lg border border-line bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <Heading className="font-display text-section font-semibold text-ink">
            {title}
          </Heading>
          {description && (
            <p className="mt-0.5 text-label text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>

      <div className="p-5">{children}</div>
    </section>
  );
}
