"use client";

import { useState } from "react";
import { cx } from "@/components/ui/cx";

export type UserAvatarSize = "sm" | "md" | "lg";

export interface UserAvatarProps {
  name?: string | null;
  photoUrl?: string | null;
  gender?: "male" | "female" | "other" | string | null;
  size?: UserAvatarSize;
  isRaised?: boolean;
  className?: string;
}

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
} as const;

const ICON_SIZES = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-7 w-7",
} as const;

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

/** First letters of the first two words — "Anita Rao" becomes AR. */
function initialsFor(name?: string | null): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word.charAt(0));
  return letters.join("").toUpperCase();
}

/** Male professional avatar silhouette */
function MaleAvatarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C9.24 2 7 4.24 7 7c0 2.45 1.76 4.49 4.09 4.91C7.38 12.44 4.5 15.39 4.5 19v1c0 .55.45 1 1 1h13c.55 0 1-.45 1-1v-1c0-3.61-2.88-6.56-6.59-7.09C15.24 11.49 17 9.45 17 7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 9c3.04 0 5.5 2.46 5.5 5.5v.5h-11v-.5c0-3.04 2.46-5.5 5.5-5.5z" />
    </svg>
  );
}

/** Female professional avatar silhouette */
function FemaleAvatarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C9.24 2 7 4.24 7 7c0 2.22 1.45 4.1 3.48 4.75C7.07 12.48 4.5 15.44 4.5 19v1c0 .55.45 1 1 1h13c.55 0 1-.45 1-1v-1c0-3.56-2.57-6.52-5.98-7.25C15.55 11.1 17 9.22 17 7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3 0 1.05-.54 1.97-1.35 2.5-.5.33-.87.84-.98 1.42-.07.38-.28.58-.67.58s-.6-.2-.67-.58c-.11-.58-.48-1.09-.98-1.42-.81-.53-1.35-1.45-1.35-2.5 0-1.66 1.34-3 3-3zm0 9c3.04 0 5.5 2.46 5.5 5.5v.5h-11v-.5c0-3.04 2.46-5.5 5.5-5.5z" />
    </svg>
  );
}

/** Neutral avatar silhouette */
function NeutralAvatarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm9 11v-1a7 7 0 0 0-7-7h-4a7 7 0 0 0-7 7v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1zm-14-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5z" />
    </svg>
  );
}

export default function UserAvatar({
  name,
  photoUrl,
  gender,
  size = "md",
  isRaised = false,
  className,
}: UserAvatarProps) {
  const cleanPhotoUrl = photoUrl?.trim() || null;
  const isCandidatePhoto = isValidImageUrl(cleanPhotoUrl);
  const [errorPhotoUrl, setErrorPhotoUrl] = useState<string | null>(null);
  const imageFailed = Boolean(cleanPhotoUrl && errorPhotoUrl === cleanPhotoUrl);

  const cleanGender = gender ? gender.trim().toLowerCase() : null;

  // 1. Priority 1: Real Profile Photo
  if (isCandidatePhoto && !imageFailed && cleanPhotoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-indigo-200/50 bg-slate-100 shadow-xs select-none",
          SIZES[size],
          isRaised && "shadow-card",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cleanPhotoUrl}
          alt={name ? `${name}'s avatar` : "User avatar"}
          onError={() => setErrorPhotoUrl(cleanPhotoUrl)}
          className="h-full w-full rounded-full object-cover select-none"
          loading="eager"
        />
      </span>
    );
  }

  // 2. Priority 2: Stored Gender-Aware Avatar
  if (cleanGender === "male" || cleanGender === "m") {
    return (
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white/90 shadow-xs select-none",
          SIZES[size],
          isRaised && "shadow-card",
          className,
        )}
      >
        <MaleAvatarIcon className={ICON_SIZES[size]} />
      </span>
    );
  }

  if (cleanGender === "female" || cleanGender === "f") {
    return (
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white/90 shadow-xs select-none",
          SIZES[size],
          isRaised && "shadow-card",
          className,
        )}
      >
        <FemaleAvatarIcon className={ICON_SIZES[size]} />
      </span>
    );
  }

  if (cleanGender === "other" || cleanGender === "neutral") {
    return (
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white/90 shadow-xs select-none",
          SIZES[size],
          isRaised && "shadow-card",
          className,
        )}
      >
        <NeutralAvatarIcon className={ICON_SIZES[size]} />
      </span>
    );
  }

  // 3. Priority 3: Fallback to Initials
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 font-semibold text-white shadow-xs select-none",
        SIZES[size],
        isRaised && "shadow-card",
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
