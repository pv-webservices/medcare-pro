import { Plus } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * The MedCare Pro lockup: mark plus wordmark.
 *
 * GLOBAL BRAND ONLY. These screens are the platform's front door — no tenant
 * has been resolved yet and no clinic branding is loaded, so nothing here is
 * ever driven by account data. Clinic identity starts after sign-in.
 *
 * The mark is the same cross the signed-in app uses, in the auth palette's
 * indigo rather than the app's teal. One gradient, one object, no glow.
 */

interface AuthBrandMarkProps {
  /** `md` for the brand panel, `sm` for the mobile header above the card. */
  size?: "sm" | "md";
  /** Hidden on the compact mobile header, where vertical space is the scarcest thing. */
  showTagline?: boolean;
  className?: string;
}

const TILE: Record<"sm" | "md", string> = {
  sm: "h-9 w-9 rounded-[11px]",
  md: "h-10 w-10 rounded-xl",
};

const ICON: Record<"sm" | "md", string> = {
  sm: "h-[18px] w-[18px]",
  md: "h-5 w-5",
};

const WORDMARK: Record<"sm" | "md", string> = {
  sm: "text-[16px]",
  md: "text-[19px]",
};

export default function AuthBrandMark({
  size = "md",
  showTagline = false,
  className,
}: AuthBrandMarkProps) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "flex shrink-0 items-center justify-center bg-linear-to-br from-auth-primary-bright to-auth-primary text-auth-primary-ink shadow-auth-cta",
          TILE[size],
        )}
      >
        <Plus className={ICON[size]} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span
          className={cx(
            "block font-semibold leading-none tracking-[-0.01em] text-auth-ink",
            WORDMARK[size],
          )}
        >
          MedCare&nbsp;Pro
        </span>
        {showTagline && (
          <span className="mt-1 block text-[12px] font-medium leading-none text-auth-muted">
            Clinic management platform
          </span>
        )}
      </span>
    </div>
  );
}
