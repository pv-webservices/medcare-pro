import {
  CalendarDays,
  Building2,
  Stethoscope,
  TrendingUp,
  Users,
} from "lucide-react";

/**
 * The abstraction of the product that sits in the brand panel.
 *
 * NOT A SCREENSHOT, AND NOT AN ILLUSTRATION. It is a reduced drawing of the
 * workspace: white cards, hairlines, one indigo accent, the module icons the
 * app actually has. Someone who has used MedCare Pro should recognise the
 * shape; someone who has not should read "software", not "clip art".
 *
 * IT CARRIES NO DATA, ON PURPOSE. Every value is a neutral bar rather than a
 * number, so this screen never invents a patient count, a revenue figure or a
 * clinic name — inventing one on the page in front of a prospective customer is
 * how a demo becomes a claim. Labels name real modules and nothing else.
 *
 * A server component with no state: the sign-in screen should not ship
 * JavaScript for a decoration.
 */

/** Neutral bars stand in for values. Widths vary so the block does not read as a table. */
function Bar({ width }: { width: string }) {
  return (
    <span
      aria-hidden="true"
      className="block h-2 rounded-full bg-auth-bg-tint"
      style={{ width }}
    />
  );
}

const MODULES = [
  { icon: Users, label: "Patients", width: "72%" },
  { icon: Stethoscope, label: "Doctors", width: "54%" },
  { icon: TrendingUp, label: "Revenue", width: "64%" },
] as const;

/** Mon–Sun. The fourth is "today" — a position, not a date. */
const WEEK = ["M", "T", "W", "T", "F", "S", "S"] as const;
const TODAY_INDEX = 3;

export default function AuthProductPreview() {
  return (
    <div aria-hidden="true" className="relative w-full max-w-[420px] select-none">
      {/* The workspace card */}
      <div className="rounded-[20px] border border-auth-line bg-auth-card p-5 shadow-auth-float">
        {/* Title row — a clinic switcher with no clinic in it */}
        <div className="flex items-center gap-3 border-b border-auth-line pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-auth-primary-soft text-auth-primary-soft-ink">
            <Building2 className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <span className="flex-1 space-y-1.5">
            <Bar width="42%" />
            <Bar width="26%" />
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-auth-ok-bg px-2.5 py-1">
            <span className="auth-breathe h-1.5 w-1.5 rounded-full bg-auth-ok-mark" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-auth-ok-ink">
              Live
            </span>
          </span>
        </div>

        {/* Three modules, each a labelled tile with a value-shaped bar */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {MODULES.map((module) => {
            const Icon = module.icon;
            return (
              <div
                key={module.label}
                className="rounded-[14px] border border-auth-line bg-auth-bg/60 p-3"
              >
                <Icon
                  className="h-4 w-4 text-auth-primary"
                  strokeWidth={2}
                />
                <span className="mt-2.5 block text-[11px] font-semibold text-auth-muted">
                  {module.label}
                </span>
                <span className="mt-2 block">
                  <Bar width={module.width} />
                </span>
              </div>
            );
          })}
        </div>

        {/* The week strip */}
        <div className="mt-4 rounded-[14px] border border-auth-line p-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-auth-muted" strokeWidth={2} />
            <Bar width="34%" />
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {WEEK.map((day, index) => (
              <span
                key={`${day}-${index}`}
                className={
                  index === TODAY_INDEX
                    ? "flex h-7 items-center justify-center rounded-lg bg-auth-primary text-[11px] font-semibold text-auth-primary-ink"
                    : "flex h-7 items-center justify-center rounded-lg bg-auth-bg-tint text-[11px] font-medium text-auth-faint"
                }
              >
                {day}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/*
        One card breaks the frame. It is the only overlap in the composition —
        two would read as a pile — and it is what stops the preview from looking
        like a flat screenshot.
      */}
      <div className="absolute -bottom-6 -right-4 flex w-[188px] items-center gap-3 rounded-[16px] border border-auth-line bg-auth-card p-3.5 shadow-auth-float sm:-right-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-auth-primary-soft text-auth-primary-soft-ink">
          <CalendarDays className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <span className="flex-1 space-y-1.5">
          <Bar width="86%" />
          <Bar width="58%" />
        </span>
      </div>
    </div>
  );
}
