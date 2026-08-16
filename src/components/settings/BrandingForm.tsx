"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Clinic branding — PRD §6.8 (FR-8.3, FR-8.4).
 *
 * Branding is per clinic: `logo_url` and `theme_color` live on `clinics` in
 * PRD §7, and there are no such columns on the account. The clinic edited here
 * is the one picked in the sidebar switcher, so this screen never disagrees
 * with the rest of the app about which clinic is in view (FR-2.3).
 *
 * The logo is a URL, not an upload. The column stores a URL, and a real upload
 * would mean adding a storage vendor — which PRD §11 asks the build to avoid.
 *
 * Validation runs as you type rather than only on submit: a mistyped hex colour
 * should be flagged at the keystroke, not after a round trip.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FALLBACK_COLOR = "#1d4ed8";

interface BrandingFormProps {
  clinicId: string;
  clinicName: string;
  logoUrl: string | null;
  themeColor: string | null;
  canEdit: boolean;
}

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

function validateLogoUrl(value: string): string | null {
  if (value === "") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// address.";
    }
    return null;
  } catch {
    return "Enter a full address, e.g. https://example.com/logo.png";
  }
}

function validateThemeColor(value: string): string | null {
  if (value === "") {
    return null;
  }
  return HEX_COLOR.test(value) ? null : "Use a hex colour like #1D4ED8.";
}

export default function BrandingForm({
  clinicId,
  clinicName,
  logoUrl,
  themeColor,
  canEdit,
}: BrandingFormProps) {
  const router = useRouter();
  const [logo, setLogo] = useState(logoUrl ?? "");
  const [colour, setColour] = useState(themeColor ?? "");
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const logoError = validateLogoUrl(logo);
  const colourError = validateThemeColor(colour);
  const hasErrors = logoError !== null || colourError !== null;

  // type="color" only understands #rrggbb, so an unset or 8-digit value falls
  // back rather than resetting the swatch to black.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : FALLBACK_COLOR;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (hasErrors) {
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Empty string clears the field — the server maps it to null.
        body: JSON.stringify({ logoUrl: logo, themeColor: colour }),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not save branding. Try again.");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {saved && (
        <p
          role="status"
          className="mb-3 rounded border border-green-700/40 bg-green-700/10 px-3 py-2 text-sm text-green-800 dark:text-green-400"
        >
          Branding saved for {clinicName}.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-4">
          <div>
            <label htmlFor="logo-url" className="mb-1 block text-sm font-medium">
              Logo address
            </label>
            <input
              id="logo-url"
              type="url"
              inputMode="url"
              value={logo}
              onChange={(event) => {
                setLogo(event.target.value);
                setLogoLoadFailed(false);
                setSaved(false);
              }}
              disabled={!canEdit}
              maxLength={2000}
              placeholder="https://example.com/logo.png"
              aria-invalid={logoError !== null}
              aria-describedby="logo-url-help"
              className={INPUT_CLASS}
            />
            <p
              id="logo-url-help"
              className={`mt-1 text-xs ${
                logoError
                  ? "text-red-700 dark:text-red-400"
                  : "text-black/60 dark:text-white/60"
              }`}
            >
              {logoError ??
                "Paste the web address of an image you already host. Leave blank for no logo."}
            </p>
          </div>

          <div>
            <label htmlFor="theme-colour" className="mb-1 block text-sm font-medium">
              Primary colour
            </label>
            <div className="flex gap-2">
              <input
                id="theme-colour"
                value={colour}
                onChange={(event) => {
                  setColour(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
                maxLength={9}
                placeholder="#1D4ED8"
                aria-invalid={colourError !== null}
                aria-describedby="theme-colour-help"
                className={INPUT_CLASS}
              />
              <input
                type="color"
                value={swatch}
                onChange={(event) => {
                  setColour(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
                aria-label="Pick the primary colour"
                className="min-h-11 w-14 shrink-0 rounded border border-black/20 bg-transparent dark:border-white/25"
              />
            </div>
            <p
              id="theme-colour-help"
              className={`mt-1 text-xs ${
                colourError
                  ? "text-red-700 dark:text-red-400"
                  : "text-black/60 dark:text-white/60"
              }`}
            >
              {colourError ?? "Hex value, e.g. #1D4ED8. Leave blank for no colour."}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">Preview</p>
          <div className="rounded border border-black/15 p-4 dark:border-white/20">
            <div className="flex items-center gap-3">
              {logo !== "" && logoError === null && !logoLoadFailed ? (
                // Plain <img>: the address is user-supplied and arbitrary, which
                // next/image would need a configured remote host for.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt=""
                  onError={() => setLogoLoadFailed(true)}
                  className="h-10 w-auto max-w-32 object-contain"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-black/25 text-xs text-black/50 dark:border-white/30 dark:text-white/50">
                  {logoLoadFailed ? "!" : "—"}
                </span>
              )}
              <span className="font-semibold">{clinicName}</span>
            </div>

            {logoLoadFailed && (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-400">
                That address did not load an image. Check the link is public.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-8 rounded border border-black/15 dark:border-white/20"
                style={{ backgroundColor: colourError ? "transparent" : swatch }}
              />
              <button
                type="button"
                disabled
                style={
                  colourError ? undefined : { backgroundColor: swatch, color: "#fff" }
                }
                className="min-h-11 rounded px-5 text-base font-medium disabled:opacity-100"
              >
                Log Appointment
              </button>
            </div>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">
              An example button, so the colour can be judged against a real
              control rather than a swatch alone.
            </p>
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="mt-4">
          <button
            type="submit"
            disabled={isSaving || hasErrors}
            className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Branding"}
          </button>
        </div>
      ) : (
        <p className="mt-4 rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot edit this clinic&apos;s branding. Ask an admin or the
          account owner if you need access.
        </p>
      )}
    </form>
  );
}
