import type {
  CSSProperties,
  ReactNode,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one list pattern — clinics, doctors, registrations, notifications,
 * messages all use this shell, so staff learn to read a table once.
 *
 * Two rules are baked in rather than left to call sites:
 *  - Numeric columns are right-aligned with tabular figures, so amounts and
 *    counts line up down the page.
 *  - The wrapper scrolls, not the page. A wide table on a tablet must never
 *    push the sidebar off-screen.
 *
 * Below tablet, render the same fields as stacked `Card`s instead. This shell
 * is `hidden md:block` at the call site, not here, because the two views
 * usually differ in which columns they carry.
 */

type Align = "start" | "end";

interface TableProps {
  /** Describes the list for screen readers, e.g. "Clinics in this account". */
  caption: string;
  className?: string;
  children: ReactNode;
}

export default function Table({ caption, className, children }: TableProps) {
  return (
    <div
      className={cx(
        "overflow-x-auto rounded-lg border border-line bg-surface shadow-card",
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

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-surface-sunk">
      <tr className="border-b border-line">{children}</tr>
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
        "border-b border-line last:border-b-0",
        isCurrent ? "bg-surface-sunk" : "hover:bg-surface-sunk/60",
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
        "px-4 py-2.5 text-micro font-semibold uppercase text-muted",
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
  /**
   * Draws the clinic rail down the left edge of the row. Only the first cell
   * should set it — see the accent rules in the admin-dashboard-ui skill.
   */
  hasRail?: boolean;
  children: ReactNode;
}

export function TD({
  align,
  isNumeric = false,
  hasRail = false,
  className,
  children,
  ...rest
}: TDProps) {
  const resolved: Align = align ?? (isNumeric ? "end" : "start");

  return (
    <td
      className={cx(
        "px-4 py-3 align-middle",
        hasRail && "relative pl-6",
        resolved === "end" ? "text-right" : "text-left",
        isNumeric && "tabular-nums",
        className,
      )}
      {...rest}
    >
      {hasRail && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-accent"
        />
      )}
      {children}
    </td>
  );
}
