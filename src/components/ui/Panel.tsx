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
        "rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-50 px-6 py-5">
        <div className="min-w-0 flex-1">
          <Heading className="text-base font-bold text-slate-900">
            {title}
          </Heading>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>

      <div className="p-6">{children}</div>
    </section>
  );
}
