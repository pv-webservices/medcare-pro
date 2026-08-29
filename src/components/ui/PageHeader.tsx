import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The top of every screen: where am I, what is this, what can I do here.
 *
 * ONE STRUCTURE FOR ELEVEN MODULES. Breadcrumb (leaf screens only), title,
 * one-line description, actions on the right. It is a primitive rather than
 * per-page markup because the description line is the thing staff read to know
 * whether the list in front of them is the whole list or a filtered slice — and
 * a line phrased differently on every screen stops being read at all.
 *
 * `scope` is the multi-clinic answer to "whose data am I looking at". The
 * clinic switcher in the shell governs the selection; this is where the
 * consequence of that selection is stated, so nobody has to guess whether a
 * number covers one clinic or the whole account.
 *
 * BREADCRUMBS ARE FOR LEAVES ONLY. Appointments -> Appointment details, or
 * Settings -> Roles. A crumb trail on a top-level list is one line of chrome
 * saying the same thing the title already said.
 */

export interface Crumb {
  label: string;
  /** Omit on the current page — the last crumb is text, not a link. */
  href?: string;
}

interface PageHeaderProps {
  title: string;
  /** One line under the title. What this screen is for, in plain words. */
  description?: ReactNode;
  /** Counts and filter state — rendered beside the description. */
  meta?: ReactNode;
  /** "Clinic A" or "All clinics". The scope the numbers on this page cover. */
  scope?: ReactNode;
  /** The page's actions, right-aligned beside the title. */
  actions?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  /** A way back out of a leaf screen, for when a crumb trail is overkill. */
  back?: { href: string; label: string };
  className?: string;
}

/**
 * A number inside a meta line. Numbers are the reason these screens exist, so
 * they step up in weight and colour while the words around them stay muted —
 * and they are tabular, so a count that changes does not shift the line.
 */
export function Count({ children }: { children: ReactNode }) {
  return <span className="tnum font-semibold text-ink">{children}</span>;
}

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-meta font-medium text-muted">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  strokeWidth={2}
                  className="h-3.5 w-3.5 text-faint"
                />
              )}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="rounded transition-colors duration-150 hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className="text-ink">
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function PageHeader({
  title,
  description,
  meta,
  scope,
  actions,
  breadcrumbs,
  back,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx("mb-5 md:mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}

      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1.5 rounded text-body font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          {back.label}
        </Link>
      )}

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-title font-semibold text-ink">{title}</h1>
            {scope && (
              <span className="inline-flex items-center rounded-full border border-line bg-canvas-deep px-2.5 py-1 text-meta font-medium text-muted">
                {scope}
              </span>
            )}
          </div>

          {description && (
            <p className="mt-1 max-w-[70ch] text-label text-muted sm:text-body">{description}</p>
          )}
          {meta && <div className="mt-1.5 text-label text-muted">{meta}</div>}
        </div>

        {actions && (
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">{actions}</div>
        )}
      </div>
    </header>
  );
}
