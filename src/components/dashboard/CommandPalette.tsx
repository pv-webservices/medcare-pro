"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import type { NavLink } from "@/lib/navigation";
import { cx } from "@/components/ui";

/**
 * The header's search control, and the palette behind it.
 *
 * WHAT IT DOES AND DOES NOT DO — read this before "finishing" it. There is no
 * record search endpoint in this application yet, so this does not pretend to
 * search patients, appointments or registrations. It jumps to the modules and
 * the create screens THIS user can reach, which is real, immediately useful,
 * and honest. The empty result says plainly that record search is not available
 * yet rather than showing a spinner that will never resolve.
 *
 * WHEN A SEARCH ROUTE EXISTS: keep the shell, add grouped result sections above
 * the navigation ones, and gate each group on the same permission that gates
 * its module — a palette that reveals a patient name to someone who cannot open
 * the Registrations module would be a data leak dressed as a convenience.
 *
 * THE ENTRIES ARE ALREADY FILTERED. `links` and `actions` arrive from the
 * layout, which built them from the actor's permissions and the account's
 * enabled modules. Nothing is filtered here and nothing may be added here.
 */

export interface PaletteAction {
  href: string;
  label: string;
  hint: string;
}

interface CommandPaletteProps {
  links: readonly NavLink[];
  actions: readonly PaletteAction[];
}

interface PaletteEntry {
  href: string;
  label: string;
  hint: string;
  group: string;
}

export default function CommandPalette({ links, actions }: CommandPaletteProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...actions.map((action) => ({ ...action, group: "Quick actions" })),
      ...links.map((link) => ({
        href: link.href,
        label: link.label,
        hint: "Go to module",
        group: "Navigate",
      })),
    ],
    [actions, links],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return entries;
    }
    return entries.filter((entry) =>
      `${entry.label} ${entry.hint}`.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  /** Cmd/Ctrl+K from anywhere in the app opens it. */
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openerRef.current = document.activeElement as HTMLElement | null;
        setIsOpen(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      openerRef.current?.focus();
    };
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) {
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : results.length - 1;
      setActiveIndex((current) => (current + step) % results.length);
      return;
    }

    if (event.key === "Enter") {
      const target = results[activeIndex];
      if (target) {
        event.preventDefault();
        go(target.href);
      }
    }
  }

  let lastGroup = "";

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          openerRef.current = event.currentTarget;
          setIsOpen(true);
        }}
        className="flex h-10 w-full max-w-xs items-center gap-2.5 rounded-2xl border border-line bg-canvas px-3 text-left text-body text-muted shadow-card transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <Search aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">Search MedCare Pro</span>
        <kbd className="hidden shrink-0 rounded-md border border-line bg-canvas-deep px-1.5 py-0.5 font-sans text-meta font-medium text-muted lg:block">
          Ctrl K
        </kbd>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-[12vh]"
          onKeyDown={handleKeyDown}
        >
          <div
            aria-hidden="true"
            onClick={close}
            className="overlay-in absolute inset-0 bg-[rgb(12_16_28/0.45)] backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search and navigate"
            className="panel-in relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-canvas shadow-float"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search
                aria-hidden="true"
                strokeWidth={2}
                className="h-4 w-4 shrink-0 text-muted"
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-autocomplete="list"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Jump to a module or start a task"
                className="h-14 w-full border-0 bg-transparent text-input text-ink outline-none placeholder:text-faint"
              />
            </div>

            <div id="command-results" role="listbox" className="max-h-[22rem] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-body text-muted">
                  Nothing here matches that. Searching patient and appointment
                  records is not available yet.
                </p>
              ) : (
                results.map((entry, index) => {
                  const showGroup = entry.group !== lastGroup;
                  lastGroup = entry.group;
                  const isActive = index === activeIndex;

                  return (
                    <div key={`${entry.group}-${entry.href}`}>
                      {showGroup && (
                        <p className="px-3 pb-1.5 pt-3 text-micro font-semibold uppercase text-faint">
                          {entry.group}
                        </p>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(entry.href)}
                        className={cx(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150",
                          isActive ? "bg-accent-soft" : "hover:bg-canvas-deep",
                        )}
                      >
                        <ArrowRight
                          aria-hidden="true"
                          strokeWidth={2}
                          className={cx(
                            "h-4 w-4 shrink-0",
                            isActive ? "text-accent" : "text-faint",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cx(
                              "block truncate text-body font-medium",
                              isActive ? "text-accent-soft-ink" : "text-ink",
                            )}
                          >
                            {entry.label}
                          </span>
                          <span className="block truncate text-meta text-muted">
                            {entry.hint}
                          </span>
                        </span>
                        {isActive && (
                          <CornerDownLeft
                            aria-hidden="true"
                            strokeWidth={2}
                            className="h-3.5 w-3.5 shrink-0 text-accent"
                          />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <p className="border-t border-line bg-canvas-deep px-4 py-2.5 text-meta text-muted">
              Record search is coming. For now this jumps between modules and
              tasks you have access to.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
