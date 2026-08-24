import { cx } from "@/components/ui/cx";

/**
 * The initial-circle that stands in for a patient, doctor or clinic.
 *
 * WHY A HASH AND NOT A RANDOM COLOUR. The colour is derived from the name, so
 * the same person is the same colour on every screen and across every reload.
 * That is the only thing that makes these circles useful rather than
 * decorative: a receptionist scanning a schedule recognises the amber one as
 * the patient they just spoke to, before they have read the name.
 *
 * The tile is FLAT. It sits inside rows and cards that are already raised, and
 * stacking a second shadow on a 36px circle turns it to mud. The one exception
 * is the account avatar in the topbar, which is a control and passes
 * `isRaised`.
 *
 * The palette lives in globals.css (--avatar-1 … --avatar-5) with the tint
 * strength as its own token, because dark mode needs a stronger wash to read
 * at all.
 */

const PALETTE = [
  "var(--avatar-1)",
  "var(--avatar-2)",
  "var(--avatar-3)",
  "var(--avatar-4)",
  "var(--avatar-5)",
] as const;

const SIZES = {
  sm: "h-9 w-9 text-meta",
  md: "h-10 w-10 text-label",
  lg: "h-12 w-12 text-body",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * A small stable string hash. Not cryptographic and not trying to be — it needs
 * to be deterministic and cheap, and to spread short names across five buckets.
 */
function paletteFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** First letters of the first two words — "Anita Rao" becomes AR. */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const letters = words.slice(0, 2).map((word) => word.charAt(0));
  return letters.join("").toUpperCase();
}

interface AvatarProps {
  /** Drives both the initials and the colour, so it must be the display name. */
  name: string;
  size?: AvatarSize;
  /** For the topbar account button, which is pressable. */
  isRaised?: boolean;
  className?: string;
}

export default function Avatar({
  name,
  size = "md",
  isRaised = false,
  className,
}: AvatarProps) {
  const colour = paletteFor(name);

  return (
    <span
      // aria-hidden: the name is always rendered beside or inside the control
      // that owns this, so announcing "AR" as well is noise.
      aria-hidden="true"
      style={{
        color: colour,
        background: `color-mix(in srgb, ${colour} var(--avatar-tint), transparent)`,
      }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        SIZES[size],
        isRaised && "shadow-neu-raised-sm",
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
