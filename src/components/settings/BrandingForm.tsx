"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";

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

function validateLogoUrl(value: string): string | null {
  if (value === "") {
    return null;
  }
  // Accept base64 data URLs from file upload
  if (value.startsWith("data:image/")) {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasUploadedLogo = logo.startsWith("data:image/");

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (PNG, JPG, SVG, etc.).");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2 MB.");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo(reader.result);
        setLogoLoadFailed(false);
        setSaved(false);
      }
    };
    reader.readAsDataURL(file);
  }

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
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {saved && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          Branding saved for {clinicName}.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Logo
            </label>

            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={!canEdit}
              className="hidden"
            />

            {/* Preview of uploaded logo */}
            {hasUploadedLogo && (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo}
                  alt="Uploaded logo"
                  className="h-12 w-auto max-w-[120px] rounded object-contain"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">Logo uploaded</p>
                  <p className="text-xs text-slate-500">Image loaded from your device</p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogo("");
                      setSaved(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {/* Upload button + URL input */}
            {!hasUploadedLogo && (
              <>
                {canEdit && (
                  <div className="flex gap-3 mb-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4 text-slate-500">
                        <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                      </svg>
                      Upload from device
                    </button>
                    <span className="self-center text-xs text-slate-400">or</span>
                  </div>
                )}
                <Input
                  id="logo-url"
                  name="logoUrl"
                  label="Logo URL"
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
                  error={logoError ?? undefined}
                  hint={!logoError ? "Paste a web address or upload from your device. Max 2 MB." : undefined}
                />
              </>
            )}
          </div>

          <div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="theme-colour"
                  name="themeColor"
                  label="Primary colour"
                  value={colour}
                  onChange={(event) => {
                    setColour(event.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                  maxLength={9}
                  placeholder="#1D4ED8"
                  error={colourError ?? undefined}
                  hint={!colourError ? "Hex value, e.g. #1D4ED8. Leave blank for no colour." : undefined}
                />
              </div>
              <input
                type="color"
                value={swatch}
                onChange={(event) => {
                  setColour(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
                aria-label="Pick the primary colour"
                className="mt-0.5 min-h-11 w-14 shrink-0 rounded-md border border-slate-200 bg-white cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">Preview</p>
          <Card className="p-5">
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
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400 bg-slate-50">
                  {logoLoadFailed ? "!" : "—"}
                </span>
              )}
              <span className="font-semibold text-slate-900">{clinicName}</span>
            </div>

            {logoLoadFailed && (
              <p className="mt-2 text-xs text-amber-700">
                That address did not load an image. Check the link is public.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-block size-8 rounded-md border border-slate-200"
                style={{ backgroundColor: colourError ? "transparent" : swatch }}
              />
              <button
                type="button"
                disabled
                style={
                  colourError ? undefined : { backgroundColor: swatch, color: "#fff" }
                }
                className="min-h-11 rounded-md px-5 text-sm font-medium shadow-sm"
              >
                Log Appointment
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              An example button, so the colour can be judged against a real
              control rather than a swatch alone.
            </p>
          </Card>
        </div>
      </div>

      {canEdit ? (
        <div className="pt-2">
          <Button
            type="submit"
            disabled={isSaving || hasErrors}
            variant="commit"
            isBusy={isSaving}
            busyLabel="Saving…"
          >
            Save Branding
          </Button>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Your role cannot edit this clinic&apos;s branding. Ask an admin or the
          account owner if you need access.
        </p>
      )}
    </form>
  );
}
