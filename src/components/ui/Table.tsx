import type {
  CSSProperties,
  ReactNode,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one list pattern. Clinics, doctors, registrations, notifications,
 * messages, appointments and team all use this shell, so staff learn to read a
 * table once and it holds everywhere.
 *
 * THE DESIGN IS MOSTLY SUBTRACTION. One hairline around the surface, one under
 * the header, one between rows. No vertical rules, no zebra striping, no
 * borders around cells — that is a spreadsheet, and a spreadsheet is what a
 * table looks like when nobody decided what mattered on it.
 *
 * Three behaviours are baked in rather than left to call sites:
 *  - Numeric columns are right-aligned with tabular figures, so amounts and
 *    counts line up down the page and a long column can be scanned.
 *  - The WRAPPER scrolls, not the page. A wide table on a tablet must never
 *    push the sidebar off-screen.
 *  - The header can stick (`hasStickyHeader`) for long lists, so the column
 *    names are still there four hundred rows down.
 *
 * Below `md`, render the same records as stacked cards instead. That switch is
 * made at the call site, not here, because the two views rarely carry the same
 * columns — a phone shows the four fields that identify a record, not eleven.
 */

type Align = "start" | "end";

interface TableProps {
  /** Describes the list for screen readers, e.g. "Registrations in this clinic". */
  caption: string;
  /** Keeps the column names visible on a long list. */
  hasStickyHeader?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Table({
  caption,
  hasStickyHeader = false,
  className,
  children,
}: TableProps) {
  return (
    <div
      className={cx(
        "overflow-x-auto rounded-2xl border border-line bg-canvas shadow-card",
        hasStickyHeader && "max-h-[70vh] overflow-y-auto",
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-body">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function THead({
  isSticky = false,
  children,
}: {
  isSticky?: boolean;
  children: ReactNode;
}) {
  return (
    <thead
      className={cx(
        "bg-canvas-deep",
        isSticky && "sticky top-0 z-10 shadow-[0_1px_0_var(--line)]",
      )}
    >
      <tr>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

interface TRProps {
  /** Marks the row as the current selection — pairs with an "accent" pill. */
  isCurrent?: boolean;
  /** Scopes custom properties to one row — used to give each row its own rail. */
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function TR({ isCurrent = false, style, className, children }: TRProps) {
  return (
    <tr
      style={style}
      className={cx(
        "border-b border-line transition-colors duration-150 last:border-b-0",
        isCurrent ? "bg-accent-soft/50" : "hover:bg-canvas-deep",
        className,
      )}
    >
      {children}
    </tr>
  );
}

interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: Align;
  children: ReactNode;
}

export function TH({ align = "start", className, children, ...rest }: THProps) {
  return (
    <th
      scope="col"
      className={cx(
        // Column headers are read, not decorative: they tell a receptionist
        // which number is the fee and which is the phone. They take --muted
        // (5.0:1), never --faint.
        "whitespace-nowrap px-4 py-2.5 text-micro font-semibold uppercase text-muted",
        align === "end" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

interface TDProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: Align;
  /** Numbers: right-aligned, tabular, one step up in weight. */
  isNumeric?: boolean;
  /** The record's identity in the row — one step darker than the rest. */
  isPrimary?: boolean;
  /**
   * Draws the clinic rail down the left edge of the row. Only the first cell
   * should set it.
   *
   * The rail is the ONE place a tenant colour appears in a table, which is why
   * it reads --clinic-accent rather than --accent: an arbitrary brand hex is
   * safe as a 3px bar and unsafe as anything with a label on it.
   */
  hasRail?: boolean;
  children: ReactNode;
}

export function TD({
  align,
  isNumeric = false,
  isPrimary = false,
  hasRail = false,
  className,
  children,
  ...rest
}: TDProps) {
  const resolved: Align = align ?? (isNumeric ? "end" : "start");

  return (
    <td
      className={cx(
        "px-4 py-3 align-middle text-body text-ink-soft",
        hasRail && "relative",
        resolved === "end" ? "text-right" : "text-left",
        isNumeric && "tnum font-medium text-ink",
        isPrimary && "font-medium text-ink",
        className,
      )}
      {...rest}
    >
      {hasRail && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-clinic-accent"
        />
      )}
      {children}
    </td>
  );
}
