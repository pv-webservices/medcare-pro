"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ClinicLogo, Menu, MenuLabel, MenuSeparator, menuItemClasses, cx } from "@/components/ui";
import { SELECTED_CLINIC_COOKIE } from "@/lib/cookieNames";

export interface ClinicOption {
  id: string;
  name: string;
  city?: string | null;
  logoUrl?: string | null;
}

interface ClinicSwitcherProps {
  clinics: readonly ClinicOption[];
  selectedClinicId: string | null;
  variant?: "topbar" | "sidebar";
  /** Compact drops the caption line — for the mobile drawer. */
  isCompact?: boolean;
  className?: string;
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export default function ClinicSwitcher({
  clinics,
  selectedClinicId,
  variant = "topbar",
  isCompact = false,
  className,
}: ClinicSwitcherProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(selectedClinicId ?? "");

  const active = clinics.find((clinic) => clinic.id === selected) ?? null;

  function choose(next: string) {
    setSelected(next);
    document.cookie = `${SELECTED_CLINIC_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    router.refresh();
  }

  if (clinics.length < 2) {
    const only = clinics[0] ?? null;

    if (variant === "sidebar") {
      return (
        <div
          className={cx(
            "flex min-w-0 items-center gap-3 rounded-2xl border border-slate-700/60 bg-[#0f152d] px-3.5 py-2.5 shadow-md",
            className,
          )}
        >
          <ClinicLogo clinic={only} variant="sidebar" />
          <div className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
              Viewing
            </span>
            <span className="block truncate text-xs font-semibold text-white leading-tight mt-0.5">
              {only?.name ?? "All clinics"}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cx(
          "flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 shadow-xs",
          className,
        )}
      >
        <ClinicLogo clinic={only} variant="topbar" />
        <div className="min-w-0">
          <p className="truncate text-xs sm:text-sm font-semibold text-slate-900 leading-tight">
            {only?.name ?? "All clinics"}
          </p>
          {!isCompact && (
            <p className="truncate text-[11px] text-slate-500 leading-tight mt-0.5">
              {only?.city ?? "Account-wide view"}
            </p>
          )}
        </div>
      </div>
    );
  }

  const isSidebar = variant === "sidebar";

  return (
    <Menu
      label="Switch clinic"
      className={cx("min-w-0", className)}
      panelClassName={cx(
        "w-[19rem]",
        isSidebar
          ? "bg-[#0d1427]/95 border-slate-700 text-white shadow-2xl backdrop-blur-xl"
          : "bg-white border-slate-200 shadow-xl",
      )}
      trigger={({ isOpen }) =>
        isSidebar ? (
          <span
            className={cx(
              "flex min-w-0 items-center gap-3 rounded-2xl border bg-[#0f152d] px-3.5 py-2.5 shadow-md cursor-pointer",
              "transition-colors duration-150",
              isOpen
                ? "border-indigo-500/50"
                : "border-slate-700/60 hover:border-slate-600",
            )}
          >
            <ClinicLogo clinic={active} variant="sidebar" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
                Viewing
              </span>
              <span className="block truncate text-xs font-semibold text-white leading-tight mt-0.5">
                {active?.name ?? "All clinics"}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cx(
                "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ml-auto",
                isOpen && "rotate-180 text-indigo-400",
              )}
            />
          </span>
        ) : (
          <span
            className={cx(
              "flex min-w-0 items-center gap-3 rounded-2xl border bg-white px-3.5 py-2 shadow-xs cursor-pointer",
              "transition-colors duration-150",
              isOpen
                ? "border-slate-300 ring-2 ring-indigo-500/20"
                : "border-slate-200 hover:border-slate-300",
            )}
          >
            <ClinicLogo clinic={active} variant="topbar" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-xs sm:text-sm font-semibold text-slate-900 leading-tight">
                {active?.name ?? "All clinics"}
              </span>
              {!isCompact && (
                <span className="block truncate text-[11px] text-slate-500 leading-tight mt-0.5">
                  {active ? (active.city ?? "Clinic") : "Account-wide view"}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cx(
                "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ml-1.5",
                isOpen && "rotate-180 text-indigo-600",
              )}
            />
          </span>
        )
      }
    >
      <MenuLabel className={isSidebar ? "text-slate-400" : undefined}>
        Viewing
      </MenuLabel>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected === ""}
        onClick={() => choose("")}
        className={cx(
          menuItemClasses(selected === ""),
          isSidebar && "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <ClinicLogo clinic={null} variant={variant} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">All clinics</span>
          <span
            className={cx(
              "block truncate text-meta font-normal",
              isSidebar ? "text-slate-400" : "text-muted",
            )}
          >
            Everything in this account
          </span>
        </span>
        {selected === "" && (
          <Check aria-hidden="true" strokeWidth={2.5} className="h-4 w-4 shrink-0" />
        )}
      </button>

      <MenuSeparator className={isSidebar ? "border-slate-700/80" : undefined} />
      <MenuLabel className={isSidebar ? "text-slate-400" : undefined}>
        Clinics
      </MenuLabel>

      <div className="max-h-72 overflow-y-auto">
        {clinics.map((clinic) => {
          const isCurrent = clinic.id === selected;

          return (
            <button
              key={clinic.id}
              type="button"
              role="menuitemradio"
              aria-checked={isCurrent}
              onClick={() => choose(clinic.id)}
              className={cx(
                menuItemClasses(isCurrent),
                isSidebar &&
                  "text-slate-300 hover:bg-slate-800/60 hover:text-white",
              )}
            >
              <ClinicLogo clinic={clinic} variant={variant} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{clinic.name}</span>
                {clinic.city && (
                  <span
                    className={cx(
                      "block truncate text-meta font-normal",
                      isSidebar ? "text-slate-400" : "text-muted",
                    )}
                  >
                    {clinic.city}
                  </span>
                )}
              </span>
              {isCurrent && (
                <Check
                  aria-hidden="true"
                  strokeWidth={2.5}
                  className="h-4 w-4 shrink-0"
                />
              )}
            </button>
          );
        })}
      </div>
    </Menu>
  );
}
