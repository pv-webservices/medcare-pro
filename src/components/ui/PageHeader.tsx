import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The top of every screen: where am I, how much is here, what can I do.
 *
 * It is a primitive rather than markup per page because the meta line is the
 * one thing staff scan to know whether the list in front of them is the whole
 * list or a filtered slice of it. If each page phrased that differently, the
 * line would stop being read.
 */

interface PageHeaderProps {
  title: string;
  /** One line under the title — counts, clinic scope, filter state. */
  meta?: ReactNode;
  /** The page's actions, right-aligned beside the title. */
  actions?: ReactNode;
  /** A way back out of a leaf screen. Omitted on top-level lists. */
  back?: { href: string; label: string };
  className?: string;
}

/**
 * A number inside a meta line. Numbers are the reason these screens exist, so
 * they step up in weight and colour while the words around them stay muted —
 * and they are tabular, so a count that changes does not shift the line.
 */
export function Count({ children }: { children: ReactNode }) {
  return <span className="font-bold tabular-nums text-slate-900">{children}</span>;
}

export default function PageHeader({
  title,
  meta,
  actions,
  back,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx("mb-6 md:mb-8", className)}>
      {back && (
        <Link
          href={back.href}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          {back.label}
        </Link>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {meta && <div className="mt-1.5 text-sm text-slate-500">{meta}</div>}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
