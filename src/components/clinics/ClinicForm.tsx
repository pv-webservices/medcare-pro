"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input, { Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

/**
 * Add/edit a clinic — PRD §6.2 (FR-2.1).
 *
 * One component serves both, so the two never drift apart in field set or
 * validation. Validation runs as the user types (not only on submit), because a
 * front-desk worker should see a bad value flagged before they reach the button.
 */

export interface ClinicFormValues {
  id?: string;
  name: string;
  address: string;
  city: string;
  logoUrl: string;
  themeColor: string;
}

interface ClinicFormProps {
  /** Present = edit an existing clinic; absent = create a new one. */
  initial?: ClinicFormValues;
  onCancel?: () => void;
}

const EMPTY: ClinicFormValues = {
  name: "",
  address: "",
  city: "",
  logoUrl: "",
  themeColor: "",
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type FieldErrors = Partial<Record<keyof ClinicFormValues, string>>;

/** Mirrors the zod rules in src/lib/clinics.ts — the server remains authoritative. */
function validate(values: ClinicFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (values.name.trim().length === 0) {
    errors.name = "Enter the clinic name.";
  }



  if (values.logoUrl.trim()) {
    const trimmed = values.logoUrl.trim();
    // Accept both remote URLs and base64 data URLs from file upload
    if (!trimmed.startsWith("data:image/")) {
      try {
        new URL(trimmed);
      } catch {
        errors.logoUrl = "Enter a full URL, starting with https://";
      }
    }
  }

  return errors;
}

export default function ClinicForm({ initial, onCancel }: ClinicFormProps) {
  const router = useRouter();
  const showToast = useToast();
  const isEdit = Boolean(initial?.id);

  const [values, setValues] = useState<ClinicFormValues>(initial ?? EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof ClinicFormValues, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;
  const swatch = values.themeColor.trim();
  const hasUploadedLogo = values.logoUrl.startsWith("data:image/");

  function update(field: keyof ClinicFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function touch(field: keyof ClinicFormValues) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Only allow image files
    if (!file.type.startsWith("image/")) {
      setFormError("Please select an image file (PNG, JPG, SVG, etc.).");
      return;
    }

    // Cap at 2 MB to keep the payload reasonable
    if (file.size > 2 * 1024 * 1024) {
      setFormError("Logo must be under 2 MB.");
      return;
    }

    setFormError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update("logoUrl", reader.result);
        touch("logoUrl");
      }
    };
    reader.readAsDataURL(file);
  }

  /** Only surface a field error once the user has engaged with that field. */
  function errorFor(field: keyof ClinicFormValues): string | undefined {
    return touched[field] ? errors[field] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (hasErrors) {
      // Reveal every outstanding problem at once rather than one per attempt.
      setTouched({ name: true, address: true, city: true, logoUrl: true });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        isEdit ? `/api/clinics/${initial?.id}` : "/api/clinics",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name.trim(),
            address: values.address.trim(),
            city: values.city.trim(),
            logoUrl: values.logoUrl.trim(),
          }),
        },
      );

      const body: { success?: boolean; error?: string; data?: { id: string } } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setFormError(body.error ?? "Could not save the clinic. Try again.");
        return;
      }

      if (isEdit) {
        showToast({ tone: "ok", title: "Changes saved." });
        router.refresh();
        onCancel?.();
      } else {
        showToast({
          tone: "ok",
          title: `${values.name.trim()} added.`,
          detail: "Add doctors next — registrations need one.",
        });
        // Straight to the new clinic — the next thing staff do is add doctors.
        router.push(`/clinics/${body.data?.id ?? ""}`);
        router.refresh();
      }
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="clinic-name"
          name="name"
          label="Clinic name"
          type="text"
          autoComplete="organization"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => touch("name")}
          error={errorFor("name")}
          fieldClassName="sm:col-span-2"
        />

        <Textarea
          id="clinic-address"
          name="address"
          label="Address"
          autoComplete="street-address"
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
          fieldClassName="sm:col-span-2"
        />

        <Input
          id="clinic-city"
          name="city"
          label="City"
          type="text"
          autoComplete="address-level2"
          value={values.city}
          onChange={(e) => update("city", e.target.value)}
        />



        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Logo
          </label>

          {/* Hidden native file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Preview of uploaded logo */}
          {hasUploadedLogo && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={values.logoUrl}
                alt="Uploaded logo"
                className="h-12 w-auto max-w-[120px] rounded object-contain"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">Logo uploaded</p>
                <p className="text-xs text-slate-500">Image loaded from your device</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  update("logoUrl", "");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-900 transition-colors"
              >
                Remove
              </button>
            </div>
          )}

          {/* Upload button + URL input */}
          {!hasUploadedLogo && (
            <>
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
              <Input
                id="clinic-logo"
                name="logoUrl"
                label="Logo URL"
                type="url"
                placeholder="https://…"
                value={values.logoUrl}
                onChange={(e) => update("logoUrl", e.target.value)}
                onBlur={() => touch("logoUrl")}
                error={errorFor("logoUrl")}
                hint="Paste a web address or upload an image from your device. Max 2 MB."
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="commit"
          isBusy={isSaving}
          busyLabel={isEdit ? "Saving…" : "Adding Clinic…"}
        >
          {isEdit ? "Save Changes" : "Add Clinic"}
        </Button>

        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
