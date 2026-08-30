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
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      return true;
    }
    // On the /settings landing page, Dashboard is the active tab
    if (pathname === "/settings" && href === "/settings/dashboard") {
      return true;
    }
    return false;
  }

  return (
    <nav
      aria-label={label}
      className={cx("-mx-1 overflow-x-auto px-1 pb-1", className)}
    >
      <ul className="flex min-w-max items-center gap-2 rounded-2xl border border-line bg-canvas px-4 py-2.5 shadow-card sm:gap-6 sm:px-6">
        {items.map((item) => {
          const active = isActive(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex min-h-9 items-center gap-2 px-1 py-1.5 text-body font-medium transition-colors duration-150",
                  active
                    ? "text-accent font-semibold"
                    : "text-muted hover:text-ink",
                )}
              >
                <span>{item.label}</span>
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
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-2.5 left-0 right-0 h-[2.5px] rounded-full bg-accent"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
