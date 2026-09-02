"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CheckCircle2,
  Image as ImageIcon,
  Info,
  Lightbulb,
  MapPin,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import Input from "@/components/ui/Input";

interface BrandingFormProps {
  clinicId: string;
  clinicName: string;
  clinicAddress: string | null;
  clinicCity: string | null;
  logoUrl: string | null;
  themeColor: string | null;
  canEdit: boolean;
}

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
  canEdit,
}: BrandingFormProps) {
  const router = useRouter();

  const [name, setName] = useState(clinicName);
  const [address, setAddress] = useState(clinicAddress ?? "");
  const [city, setCity] = useState(clinicCity ?? "");
  const [logo, setLogo] = useState(logoUrl ?? "");
  const [logoErrorState, setLogoErrorState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasLogo = Boolean(logo.trim() && !logoErrorState);

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
        setLogoErrorState(false);
        setSaved(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    setLogo("");
    setLogoErrorState(false);
    setSaved(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const logoValidationError = validateLogoUrl(logo);
  const nameError = name.trim() === "" ? "Clinic name is required." : null;
  const hasErrors = logoValidationError !== null || nameError !== null;

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
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || null,
          city: city.trim() || null,
          logoUrl: logo.trim() || null,
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm font-medium text-rose-700 shadow-2xs"
        >
          {error}
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs sm:text-sm font-medium text-emerald-700 shadow-2xs"
        >
          Changes saved successfully.
        </div>
      )}

      {/* Responsive 2-Column Desktop Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left ~70% (8 cols) — Clinic identity Card */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs space-y-6">
            {/* Card Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-1 border-b border-slate-100">
              <div>
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  Clinic identity
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  This information appears on registration records and printed slips.
                </p>
              </div>

              <span className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-600">
                <Check className="h-3 w-3" />
                Primary information
              </span>
            </div>

            {/* Form Fields Stack */}
            <div className="space-y-4">
              {/* Clinic Name */}
              <Input
                id="clinic-name"
                name="name"
                label="Clinic name"
                icon={<Building2 className="h-4 w-4 text-slate-400" />}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
                maxLength={MAX_NAME}
                error={nameError ?? undefined}
                placeholder="Clinic name"
              />

              {/* Address */}
              <Input
                id="clinic-address"
                name="address"
                label="Address"
                icon={<MapPin className="h-4 w-4 text-slate-400" />}
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

              {/* City */}
              <Input
                id="clinic-city"
                name="city"
                label="City"
                icon={<Building2 className="h-4 w-4 text-slate-400" />}
                value={city}
                onChange={(event) => {
                  setCity(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
                maxLength={MAX_CITY}
                placeholder="City name"
                hint="Used for reports and communication."
              />

              {/* Clinic Logo Dedicated Box */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Clinic logo
                </label>
                <p className="mt-0.5 text-xs text-slate-500">
                  This logo will be used on printed documents and patient communications.
                </p>

                {/* Hidden native file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  disabled={!canEdit}
                  className="hidden"
                />

                <div className="mt-3 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left: Preview + Metadata */}
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Logo Preview Container */}
                    <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-1 shadow-2xs overflow-hidden">
                      {hasLogo ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={logo}
                          alt="Clinic logo"
                          onError={() => setLogoErrorState(true)}
                          className="h-full w-full object-contain select-none"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-400">
                          <Building2 className="h-7 w-7 text-indigo-400/80" />
                        </div>
                      )}
                    </div>

                    {/* Logo Upload Status & Format Note */}
                    <div className="min-w-0">
                      {hasLogo ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span>Logo uploaded</span>
                        </div>
                      ) : (
                        <div className="text-xs font-semibold text-slate-600">
                          No logo uploaded
                        </div>
                      )}
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        JPG or PNG &middot; Max size 2MB &middot; Recommended 512 &times; 512px
                      </p>

                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs transition-colors"
                        >
                          <Upload className="h-3.5 w-3.5 text-slate-500" />
                          <span>{hasLogo ? "Replace logo" : "Upload logo"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Right: Remove Button (if logo uploaded) */}
                  {hasLogo && canEdit && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-300 shadow-2xs transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Save Action Button */}
            {canEdit && (
              <div className="pt-2 border-t border-slate-100 flex items-center justify-start">
                <button
                  type="submit"
                  disabled={isSaving || hasErrors}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="h-4 w-4" />
                  <span>{isSaving ? "Saving..." : "Save changes"}</span>
                </button>
              </div>
            )}

            {!canEdit && (
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
                Your role cannot edit this clinic&apos;s details. Ask an admin or the account owner if you need access.
              </div>
            )}
          </div>
        </div>

        {/* Right ~30% (4 cols) — Branding tips Informational Card */}
        <div className="lg:col-span-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Lightbulb className="h-4 w-4 text-indigo-600" />
                <span>Branding tips</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                A clear identity helps your clinic build trust and stay consistent across all communications.
              </p>
            </div>

            {/* Three Benefit Rows */}
            <div className="space-y-4">
              {/* Tip 1: Square Logo */}
              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
                  <ImageIcon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Use a square logo
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                    For the best results, upload a square image (1:1 ratio).
                  </p>
                </div>
              </div>

              {/* Tip 2: Keep It Simple */}
              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Keep it simple
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                    Clean and minimal logos look best on small prints and digital screens.
                  </p>
                </div>
              </div>

              {/* Tip 3: Stay Consistent */}
              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Stay consistent
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                    Your logo helps create a professional and trusted experience.
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Informational Callout */}
            <div className="rounded-xl border border-indigo-100/80 bg-indigo-50/60 p-3.5 flex items-start gap-2.5 text-xs text-indigo-900 leading-relaxed">
              <Info className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>
                This information is used across patient records, invoices, and reports.
              </span>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
