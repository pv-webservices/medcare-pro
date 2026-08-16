import type { CSSProperties } from "react";

/**
 * Clinic accent resolution — FR-8.4.
 *
 * `Clinic.themeColor` is chosen by the account owner in settings, so it is an
 * arbitrary hex. That is fine for a rail or a swatch, but the moment a label
 * sits on top of it we owe the reader 4.5:1, and no fixed foreground colour
 * can promise that for every input. So this module derives a *pair*:
 *
 *   --accent        the raw colour. Identity only: rails, swatches, dots.
 *   --accent-solid  a fill that is guaranteed to carry --accent-ink.
 *   --accent-ink    white or near-black, whichever the fill can support.
 *
 * `--accent-solid` equals `--accent` for almost every real brand colour. It
 * only diverges in the narrow mid-tone band where neither white nor ink clears
 * 4.5:1 against the raw value, where it is darkened until white does.
 *
 * Pure functions and no React, so both the server layout and any client
 * component can call this.
 */

/** House teal — used on "All clinics", or when a clinic has set no colour. */
export const DEFAULT_ACCENT = "#0F5F6B";

/** Matches --ink in globals.css. */
const INK = "#0F1A18";
const INK_LUMINANCE = 0.00906;

const WCAG_AA = 4.5;

/** #RGB is rejected to match the column (VarChar(9)) and src/lib/clinics.ts. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): Rgb | null {
  if (!HEX_COLOR.test(value)) {
    return null;
  }

  // An 8-digit value carries alpha, which we drop: the accent always sits on
  // an opaque surface, and a half-transparent rail is not a design we offer.
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const pair = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");

  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/** sRGB → linear, per WCAG 2.x relative luminance. */
function linearize(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.04045
    ? scaled / 12.92
    : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
  );
}

function contrast(a: number, b: number): number {
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

function darken(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r * (1 - amount),
    g: rgb.g * (1 - amount),
    b: rgb.b * (1 - amount),
  };
}

export interface AccentPair {
  /** The raw clinic colour, or the house teal. */
  accent: string;
  /** A fill that provably carries `accentInk`. */
  accentSolid: string;
  /** `#FFFFFF` or `--ink`. */
  accentInk: string;
}

/**
 * Derives the accent trio from a clinic's stored theme colour.
 *
 * An unset or malformed value falls back to the house teal rather than
 * throwing: a bad colour in the database should tint a rail wrong, never take
 * a page down.
 */
export function resolveAccent(themeColor: string | null | undefined): AccentPair {
  const raw = themeColor?.trim() ?? "";
  const parsed = parseHex(raw) ?? parseHex(DEFAULT_ACCENT);

  // parseHex(DEFAULT_ACCENT) is a compile-time-known valid literal; the guard
  // exists only to satisfy the type.
  if (!parsed) {
    return {
      accent: DEFAULT_ACCENT,
      accentSolid: DEFAULT_ACCENT,
      accentInk: "#FFFFFF",
    };
  }

  const accent = toHex(parsed);
  const luminance = relativeLuminance(parsed);
  const onWhite = contrast(luminance, 1);
  const onInk = contrast(luminance, INK_LUMINANCE);

  if (Math.max(onWhite, onInk) >= WCAG_AA) {
    return {
      accent,
      accentSolid: accent,
      accentInk: onWhite >= onInk ? "#FFFFFF" : INK,
    };
  }

  // The mid-tone band where neither foreground works. Walk the fill darker in
  // small steps until white clears AA — 10 steps of 6% is always enough,
  // because black itself passes.
  let candidate = parsed;
  for (let step = 0; step < 10; step += 1) {
    candidate = darken(candidate, 0.06);
    if (contrast(relativeLuminance(candidate), 1) >= WCAG_AA) {
      break;
    }
  }

  return { accent, accentSolid: toHex(candidate), accentInk: "#FFFFFF" };
}

/**
 * The same trio as an inline `style` object, for the element that scopes the
 * accent — normally the dashboard shell, but a list row scopes its own so each
 * clinic's rail carries its own colour.
 */
export function accentStyle(themeColor: string | null | undefined): CSSProperties {
  const { accent, accentSolid, accentInk } = resolveAccent(themeColor);

  return {
    "--accent": accent,
    "--accent-solid": accentSolid,
    "--accent-ink": accentInk,
  } as CSSProperties;
}
