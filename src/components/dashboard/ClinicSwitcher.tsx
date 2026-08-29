"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Layers } from "lucide-react";
import { Menu, MenuLabel, MenuSeparator, menuItemClasses, cx } from "@/components/ui";
import { SELECTED_CLINIC_COOKIE } from "@/lib/cookieNames";

/**
 * Clinic switcher — FR-2.3. Every module is scoped by clinic, so this control
 * changes what every number on every screen means. It is treated accordingly:
 * it sits in the header, it shows what is selected without being opened, and it
 * marks the current choice inside the menu.
 *
 * THE COOKIE IS A CONVENIENCE ONLY and is trivially editable by the user. Any
 * page or route that reads it must pass it through `resolveSelectedClinicId()`,
 * which re-checks the id against the actor's own clinic scope. Never query on
 * this value directly.
 *
 * IT ONLY EVER LISTS WHAT THE ACTOR CAN REACH. The array arrives from
 * `listClinicsForActor` in the layout, which is already scoped by
 * `clinic:read`; nothing is filtered here, and nothing may be added here.
 *
 * "All clinics" means account-wide. It is the absence of a selection rather
 * than a value, which is why it posts an empty string — the same thing
 * `resolveSelectedClinicId` reads as "no clinic chosen".
 */

export interface ClinicOption {
  id: string;
  name: string;
  city?: string | null;
  logoUrl?: string | null;
}

interface ClinicSwitcherProps {
  clinics: readonly ClinicOption[];
  selectedClinicId: string | null;
  /** Compact drops the caption line — for the mobile drawer. */
  isCompact?: boolean;
  className?: string;
}

/** One year. The selection is a preference, not a credential. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function ClinicMark({
  clinic,
  className,
}: {
  clinic: ClinicOption | null;
  className?: string;
}) {
  if (clinic?.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={clinic.logoUrl}
        alt=""
        className={cx("h-8 w-8 shrink-0 rounded-xl border border-line object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink",
        className,
      )}
    >
      {clinic ? (
        <Building2 strokeWidth={2} className="h-4 w-4" />
      ) : (
        <Layers strokeWidth={2} className="h-4 w-4" />
      )}
    </span>
  );
}

export default function ClinicSwitcher({
  clinics,
  selectedClinicId,
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

  // Nothing to switch between: state the scope, do not offer a menu that has
  // one entry and no consequence.
  if (clinics.length < 2) {
    const only = clinics[0] ?? null;

    return (
      <div
        className={cx(
          "flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-canvas px-3 py-2 shadow-card",
          className,
        )}
      >
        <ClinicMark clinic={only} />
        <div className="min-w-0">
          <p className="truncate text-label font-semibold text-ink">
            {only?.name ?? "All clinics"}
          </p>
          {!isCompact && (
            <p className="truncate text-meta text-muted">
              {only?.city ?? "Account-wide view"}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Menu
      label="Switch clinic"
      className={cx("min-w-0", className)}
      panelClassName="w-[19rem]"
      trigger={({ isOpen }) => (
        <span
          className={cx(
            "flex min-w-0 items-center gap-2.5 rounded-xl border bg-canvas px-3 py-2 shadow-card",
            "transition-colors duration-150",
            isOpen ? "border-line-strong" : "border-line hover:border-line-strong",
          )}
        >
          <ClinicMark clinic={active} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-label font-semibold text-ink">
              {active?.name ?? "All clinics"}
            </span>
            {!isCompact && (
              <span className="block truncate text-meta text-muted">
                {active ? (active.city ?? "Clinic") : "Account-wide view"}
              </span>
            )}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            strokeWidth={2}
            className="h-4 w-4 shrink-0 text-faint"
          />
        </span>
      )}
    >
      <MenuLabel>Viewing</MenuLabel>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected === ""}
        onClick={() => choose("")}
        className={menuItemClasses(selected === "")}
      >
        <ClinicMark clinic={null} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">All clinics</span>
          <span className="block truncate text-meta font-normal text-muted">
            Everything in this account
          </span>
        </span>
        {selected === "" && (
          <Check aria-hidden="true" strokeWidth={2.5} className="h-4 w-4 shrink-0" />
        )}
      </button>

      <MenuSeparator />
      <MenuLabel>Clinics</MenuLabel>

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
              className={menuItemClasses(isCurrent)}
            >
              <ClinicMark clinic={clinic} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{clinic.name}</span>
                {clinic.city && (
                  <span className="block truncate text-meta font-normal text-muted">
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
