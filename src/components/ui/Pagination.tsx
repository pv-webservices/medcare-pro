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
  className?: string;
}

export default function Pagination({
  page,
  lastPage,
  total,
  firstOnPage,
  lastOnPage,
  hrefFor,
  label,
  className,
}: PaginationProps) {
  if (lastPage <= 1) {
    return null;
  }

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
      </p>

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
    </nav>
  );
}
