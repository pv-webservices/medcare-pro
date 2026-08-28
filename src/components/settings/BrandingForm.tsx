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
  clinicAddress: string | null;
  clinicCity: string | null;
  logoUrl: string | null;
  themeColor: string | null;
  canEdit: boolean;
}

/** Mirrors createClinicSchema in src/lib/clinics.ts. */
const MAX_NAME = 255;
const MAX_ADDRESS = 1000;
const MAX_CITY = 255;

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



export default function BrandingForm({
  clinicId,
  clinicName,
  clinicAddress,
  clinicCity,
  logoUrl,
  themeColor,
  canEdit,
}: BrandingFormProps) {
  const router = useRouter();
  // The clinic's own details, which used to be edited on the Clinics screen.
  // They save through the same PATCH /api/clinics/[id] the logo already used,
  // so removing that screen took no endpoint with it.
  const [name, setName] = useState(clinicName);
  const [address, setAddress] = useState(clinicAddress ?? "");
  const [city, setCity] = useState(clinicCity ?? "");
  const [logo, setLogo] = useState(logoUrl ?? "");
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
  // A clinic with no name is what the server would reject anyway; catching it
  // here means the user is told at the keystroke rather than after a round trip.
  const nameError =
    name.trim() === "" ? "Clinic name is required." : null;
  const hasErrors = logoError !== null || nameError !== null;

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
        body: JSON.stringify({
          name: name.trim(),
          address,
          city,
          logoUrl: logo,
        }),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not save your changes. Try again.");
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {saved && (
        <p
          role="status"
          className="rounded-xl bg-ok-bg px-4 py-3 text-body font-medium text-ok-ink"
        >
          Saved.
        </p>
      )}

      <div className="grid gap-6">
        <div className="grid gap-4 max-w-2xl">
          <Input
            id="clinic-name"
            name="name"
            label="Clinic name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            disabled={!canEdit}
            maxLength={MAX_NAME}
            error={nameError ?? undefined}
          />

          <Input
            id="clinic-address"
            name="address"
            label="Address"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setSaved(false);
            }}
            disabled={!canEdit}
            maxLength={MAX_ADDRESS}
            placeholder="Street, area, landmark"
            hint="Shown on registration records and printed slips."
          />

          <Input
            id="clinic-city"
            name="city"
            label="City"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setSaved(false);
            }}
            disabled={!canEdit}
            maxLength={MAX_CITY}
          />

          <div>
            <label className="mb-1.5 block text-body font-semibold text-ink">
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
              <div className="mb-3 flex items-center gap-3 rounded-xl bg-canvas-deep p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo}
                  alt="Uploaded logo"
                  className="h-12 w-auto max-w-[120px] rounded object-contain"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-ink">Logo uploaded</p>
                  <p className="text-meta text-muted">Image loaded from your device</p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogo("");
                      setSaved(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-md px-2.5 py-1.5 text-meta font-medium text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
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
                      className="inline-flex items-center gap-2 rounded-xl bg-canvas px-4 py-2.5 text-body font-medium text-ink border border-line shadow-card hover:bg-canvas-deep hover:border-line transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4 text-muted">
                        <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                      </svg>
                      Upload from device
                    </button>
                    <span className="self-center text-meta text-faint">or</span>
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
        </div>
      </div>

      {canEdit ? (
        <div className="pt-2">
          <Button
            type="submit"
            disabled={isSaving || hasErrors}
            variant="primary"
            isBusy={isSaving}
            busyLabel="Saving…"
          >
            Save changes
          </Button>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-canvas-deep px-4 py-3 text-body text-muted">
          Your role cannot edit this clinic&apos;s details. Ask an admin or the
          account owner if you need access.
        </p>
      )}
    </form>
  );
}
