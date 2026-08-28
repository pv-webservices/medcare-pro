"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";

/**
 * Section navigation rendered as tabs — Settings, and any module with sibling
 * screens.
 *
 * THESE ARE LINKS, NOT A TABLIST. Each one is a real route with its own URL,
 * its own server-side permission check and its own place in history. Wrapping
 * them in `role="tablist"` would tell a screen reader they swap panels in place,
 * which is a promise this navigation does not keep. The right semantics are a
 * `<nav>` of links with `aria-current="page"` on the active one.
 *
 * On a phone the row scrolls horizontally rather than wrapping onto three
 * lines: a wrapped tab bar pushes the actual content off the screen.
 */

export interface TabItem {
  href: string;
  label: string;
  /** Optional count, e.g. unread notifications on that section. */
  count?: number;
}

interface TabNavProps {
  items: readonly TabItem[];
  label: string;
  className?: string;
}

export default function TabNav({ items, label, className }: TabNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label={label}
      className={cx("-mx-1 overflow-x-auto px-1 pb-1", className)}
    >
      <ul className="flex min-w-max items-center gap-1 rounded-2xl border border-line bg-canvas p-1 shadow-card">
        {items.map((item) => {
          const active = isActive(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-9 items-center gap-2 rounded-xl px-3 text-body font-medium",
                  "transition-colors duration-150",
                  active
                    ? "bg-accent-soft text-accent-soft-ink"
                    : "text-muted hover:bg-canvas-deep hover:text-ink",
                )}
              >
                {item.label}
                {typeof item.count === "number" && item.count > 0 && (
                  <span
                    className={cx(
                      "tnum rounded-full px-1.5 py-0.5 text-meta font-semibold",
                      active ? "bg-accent text-accent-ink" : "bg-pill text-pill-ink",
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
