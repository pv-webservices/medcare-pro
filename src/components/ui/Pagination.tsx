import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

/**
 * Page controls for a server-rendered list.
 *
 * LINKS, NOT BUTTONS, and deliberately. Every list in this app paginates
 * through the URL, which is what makes page two shareable, bookmarkable and
 * survivable across a refresh — and what lets the browser's Back button do the
 * obvious thing. `hrefFor` is handed in by the page, which owns the shape of
 * its own query string.
 *
 * THE RANGE LINE IS THE POINT. "Showing 21-40 of 253" is the sentence that
 * tells a receptionist whether the record they are hunting for is behind them
 * or ahead, and it is the reason this is a component rather than two arrows.
 */

interface PaginationProps {
  page: number;
  lastPage: number;
  /** Total matching records, across every page. */
  total: number;
  /** 1-based index of the first record on this page. */
  firstOnPage: number;
  /** 1-based index of the last record on this page. */
  lastOnPage: number;
  /** Builds the href for a page number. */
  hrefFor: (page: number) => string;
  /** The noun being paged through, for the accessible label. */
  label: string;
  /** Visual presentation variant — default (buttons with text) or compact (numbered chips with chevrons). */
  variant?: "default" | "compact";
  /** Optional noun label displayed in the summary sentence (e.g. "appointments"). */
  itemLabel?: string;
  className?: string;
}

function getPageRange(page: number, lastPage: number): number[] {
  if (lastPage <= 5) {
    return Array.from({ length: lastPage }, (_, i) => i + 1);
  }
  let start = Math.max(1, page - 2);
  let end = Math.min(lastPage, start + 4);
  if (end - start < 4) {
    start = Math.max(1, end - 4);
  }
  const pages: number[] = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
}

export default function Pagination({
  page,
  lastPage,
  total,
  firstOnPage,
  lastOnPage,
  hrefFor,
  label,
  variant = "default",
  itemLabel,
  className,
}: PaginationProps) {
  if (lastPage <= 1) {
    return null;
  }

  const isCompact = variant === "compact";

  return (
    <nav
      aria-label={label}
      className={cx(
        "mt-4 flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <p className="text-label text-muted">
        Showing <span className="tnum font-medium text-ink">{firstOnPage}</span>
        {"–"}
        <span className="tnum font-medium text-ink">{lastOnPage}</span> of{" "}
        <span className="tnum font-medium text-ink">{total}</span>
        {itemLabel ? ` ${itemLabel}` : ""}
      </p>

      {isCompact ? (
        <div className="flex items-center gap-1.5">
          {page > 1 ? (
            <Link
              href={hrefFor(page - 1)}
              rel="prev"
              aria-label="Previous page"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-canvas text-ink transition-colors duration-150 hover:border-line-strong hover:bg-canvas-deep"
            >
              <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-canvas text-faint opacity-45 pointer-events-none"
            >
              <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </span>
          )}

          {getPageRange(page, lastPage).map((p) => {
            const isCurrent = p === page;
            return isCurrent ? (
              <span
                key={p}
                aria-current="page"
                className="inline-flex h-9 min-w-9 px-2.5 items-center justify-center rounded-xl bg-accent text-accent-ink text-label font-semibold shadow-cta"
              >
                {p}
              </span>
            ) : (
              <Link
                key={p}
                href={hrefFor(p)}
                className="inline-flex h-9 min-w-9 px-2.5 items-center justify-center rounded-xl border border-line bg-canvas text-ink text-label font-medium transition-colors duration-150 hover:border-line-strong hover:bg-canvas-deep"
              >
                {p}
              </Link>
            );
          })}

          {page < lastPage ? (
            <Link
              href={hrefFor(page + 1)}
              rel="next"
              aria-label="Next page"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-canvas text-ink transition-colors duration-150 hover:border-line-strong hover:bg-canvas-deep"
            >
              <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-canvas text-faint opacity-45 pointer-events-none"
            >
              <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="mr-1 text-label text-muted">
            Page <span className="tnum font-medium text-ink">{page}</span> of{" "}
            <span className="tnum font-medium text-ink">{lastPage}</span>
          </span>

          {page > 1 ? (
            <Link
              href={hrefFor(page - 1)}
              rel="prev"
              className={buttonClasses("secondary", "sm")}
            >
              <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={buttonClasses("secondary", "sm", "pointer-events-none opacity-45")}
            >
              <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Previous
            </span>
          )}

          {page < lastPage ? (
            <Link
              href={hrefFor(page + 1)}
              rel="next"
              className={buttonClasses("secondary", "sm")}
            >
              Next
              <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={buttonClasses("secondary", "sm", "pointer-events-none opacity-45")}
            >
              Next
              <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
