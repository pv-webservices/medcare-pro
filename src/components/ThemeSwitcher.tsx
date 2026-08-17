"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-8" aria-hidden="true" />; // Placeholder to avoid layout shift
  }

  const themes = [
    { id: "light", label: "Default", color: "bg-[#6B46C1]" },
    { id: "emerald", label: "Emerald", color: "bg-[#059669]" },
    { id: "butter", label: "Butter", color: "bg-[#fffd74] border border-slate-200" },
  ];

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            title={t.label}
            aria-label={`Switch to ${t.label} theme`}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
              theme === t.id ? "ring-2 ring-primary ring-offset-2 scale-110" : ""
            } ${t.color}`}
          >
            {theme === t.id && (
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
