"use client";

import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The accent picker, plus dark.
 *
 * THREE OF THESE ARE THE SAME DESIGN. Default, Emerald and Butter change only
 * the accent family — the canvas, the elevation recipe and the text ramp are
 * shared, because those are what make the app legible and they are not a matter
 * of taste. Dark is the one entry that swaps the whole token set.
 *
 * WHY BUTTER'S SWATCH LIES, SLIGHTLY. The dot shows the brand's pale yellow
 * (#fffd74) because that is the colour the theme is named for and the one a user
 * is picking by eye. The theme's actual control accent is a deep gold: the pale
 * yellow cannot carry white text and cannot serve as a focus ring on a light
 * canvas, and a focus ring nobody can see is the one thing this design cannot
 * afford. See the note in globals.css.
 *
 * It lives inside the account menu. A preference set once a year does not earn
 * a permanent row in the primary navigation.
 */

const THEMES = [
  { id: "light", label: "Default", swatch: "#5b4bff" },
  { id: "emerald", label: "Emerald", swatch: "#0f9d76" },
  { id: "butter", label: "Butter", swatch: "#fffd74" },
  { id: "dark", label: "Dark", swatch: "#161a26" },
] as const;

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  /*
    "Have we hydrated yet?", without a setState in an effect.

    The server cannot know the stored theme, so the swatches would paint the
    wrong selection for one frame and React would report a hydration mismatch.
    useSyncExternalStore answers false on the server and during the first client
    render, then true — which is exactly the signal needed, with no cascading
    render and nothing for the react-hooks/set-state-in-effect rule to object to.
    The store never changes, so the subscribe callback is a no-op.
  */
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!isMounted) {
    // The server cannot know the stored theme, so the swatches would paint the
    // wrong selection for one frame. Reserve the height and skip that flash.
    return <div className="h-9" aria-hidden="true" />;
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-2 rounded-xl bg-canvas-deep px-2.5 py-2"
    >
      {THEMES.map((entry) => {
        const isCurrent = theme === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTheme(entry.id)}
            title={entry.label}
            aria-label={`${entry.label} theme`}
            aria-pressed={isCurrent}
            style={{ background: entry.swatch }}
            className={cx(
              "flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(0_0_0/0.08)] transition-transform duration-150",
              isCurrent
                ? "ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-deep)]"
                : "hover:scale-110",
            )}
          >
            {isCurrent && (
              // Butter needs a dark tick; the others take white.
              <Check
                aria-hidden="true"
                strokeWidth={3}
                className={cx(
                  "h-3 w-3",
                  entry.id === "butter" ? "text-ink" : "text-white",
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
