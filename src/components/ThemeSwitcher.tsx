"use client";

import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The accent picker, plus dark.
 *
 * THREE OF THESE ARE THE SAME DESIGN. Default, Emerald and Butter change only
 * the accent family — the canvas, the depth recipe and the text ramp are shared,
 * because those are what make the app legible and they are not a matter of
 * taste. Dark is the one entry that swaps the whole token set.
 *
 * WHY BUTTER'S SWATCH LIES, SLIGHTLY. The dot shows the brand's pale yellow
 * (#fffd74) because that is the colour the theme is named for and the one a user
 * is picking by eye. The theme's actual control accent is a deep gold: the pale
 * yellow cannot carry white text and cannot serve as a focus ring on a light
 * canvas, and a focus ring nobody can see is the one thing this design cannot
 * afford. See the note in globals.css.
 */

const THEMES = [
  { id: "light", label: "Default", swatch: "#0d9488" },
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "butter", label: "Butter", swatch: "#fffd74" },
  { id: "dark", label: "Dark", swatch: "#24272f" },
] as const;

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // The server cannot know the stored theme, so the swatches would paint the
    // wrong selection for one frame. Reserve the height and skip that flash.
    return <div className="h-12" aria-hidden="true" />;
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center justify-center gap-2 rounded-2xl bg-canvas px-3 py-2.5 shadow-neu-inset"
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
              "flex h-6 w-6 items-center justify-center rounded-full transition-shadow duration-200",
              isCurrent
                ? "shadow-neu-raised-sm ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]"
                : "hover:shadow-neu-raised-sm",
            )}
          >
            {isCurrent && (
              // Butter and Dark need opposite ticks; the mid-tones take white.
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
