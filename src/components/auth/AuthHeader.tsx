import type { ReactNode } from "react";

/**
 * Heading and supporting line at the top of an auth card.
 *
 * ONE `<h1>` PER SCREEN, and it lives here — so every auth page has exactly one
 * top-level heading and a screen-reader user always lands on the name of the
 * task. 30px on mobile, 34px from `sm`: large enough to lead, deliberately not
 * marketing-sized.
 */
interface AuthHeaderProps {
  title: string;
  description?: ReactNode;
  /** The mail / shield / warning badge on the verification and outcome screens. */
  badge?: ReactNode;
}

export default function AuthHeader({
  title,
  description,
  badge,
}: AuthHeaderProps) {
  return (
    <div className="mb-7">
      {badge && <div className="mb-5">{badge}</div>}
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-auth-ink sm:text-[34px]">
        {title}
      </h1>
      {description && (
        <p className="mt-3 text-[15px] leading-relaxed text-auth-muted">
          {description}
        </p>
      )}
    </div>
  );
}
