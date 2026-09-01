"use client";

import { useState } from "react";
import { Building2, Layers } from "lucide-react";
import { cx } from "@/components/ui/cx";

export interface ClinicLogoProps {
  clinic?: {
    name?: string | null;
    logoUrl?: string | null;
    city?: string | null;
  } | null;
  variant?: "topbar" | "sidebar" | "default" | "compact";
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Checks if a string is a potentially valid image URL or data URI.
 */
function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ClinicLogo({
  clinic,
  variant = "topbar",
  size = "md",
  className,
}: ClinicLogoProps) {
  const logoUrl = clinic?.logoUrl?.trim() || null;
  const isCandidate = isValidImageUrl(logoUrl);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const hasError = Boolean(logoUrl && errorUrl === logoUrl);

  const isSidebar = variant === "sidebar";
  const isCompact = variant === "compact";

  const sizeClasses = {
    sm: "h-7 w-7",
    md: isSidebar || isCompact ? "h-8 w-8" : "h-9 w-9",
    lg: "h-12 w-12",
  }[size];

  const iconSizeClasses = {
    sm: "h-3.5 w-3.5",
    md: isSidebar || isCompact ? "h-4 w-4" : "h-4.5 w-4.5",
    lg: "h-6 w-6",
  }[size];

  // 1. Valid uploaded logo that hasn't failed to load
  if (isCandidate && !hasError && logoUrl) {
    return (
      <span
        className={cx(
          "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-colors",
          sizeClasses,
          isSidebar
            ? "border-slate-700/80 bg-[#121a36]"
            : "border-slate-200 bg-white shadow-2xs",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={clinic?.name ? `${clinic.name} logo` : "Clinic logo"}
          onError={() => setErrorUrl(logoUrl)}
          className="h-full w-full object-contain p-0.5 select-none"
          loading="eager"
        />
      </span>
    );
  }

  // 2. Sidebar dark-themed fallback
  if (isSidebar) {
    return (
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-950/80 text-indigo-400 shadow-sm transition-colors",
          sizeClasses,
          className,
        )}
      >
        {clinic ? (
          <Building2 strokeWidth={2} className={iconSizeClasses} />
        ) : (
          <Layers strokeWidth={2} className={iconSizeClasses} />
        )}
      </span>
    );
  }

  // 3. Topbar / Default light-themed fallback
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs transition-colors",
        sizeClasses,
        className,
      )}
    >
      {clinic ? (
        <Building2 strokeWidth={2} className={iconSizeClasses} />
      ) : (
        <Layers strokeWidth={2} className={iconSizeClasses} />
      )}
    </span>
  );
}
