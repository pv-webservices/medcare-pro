"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";
const INPUT_INVALID_CLASS =
  "block min-h-11 w-full rounded border border-red-600 bg-transparent px-3 text-base outline-none dark:border-red-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium";
const HINT_CLASS = "mt-1 text-xs text-black/55 dark:text-white/55";
const FIELD_ERROR_CLASS = "mt-1 text-xs text-red-700 dark:text-red-400";

type FieldErrors = Partial<Record<keyof ClinicFormValues, string>>;

/** Mirrors the zod rules in src/lib/clinics.ts — the server remains authoritative. */
function validate(values: ClinicFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (values.name.trim().length === 0) {
    errors.name = "Enter the clinic name.";
  }

  if (values.themeColor.trim() && !HEX_COLOR.test(values.themeColor.trim())) {
    errors.themeColor = "Use a hex colour like #1D4ED8.";
  }

  if (values.logoUrl.trim()) {
    try {
      new URL(values.logoUrl.trim());
    } catch {
      errors.logoUrl = "Enter a full URL, starting with https://";
    }
  }

  return errors;
}

export default function ClinicForm({ initial, onCancel }: ClinicFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [values, setValues] = useState<ClinicFormValues>(initial ?? EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof ClinicFormValues, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;

  function update(field: keyof ClinicFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
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
      setTouched({ name: true, address: true, city: true, logoUrl: true, themeColor: true });
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
            themeColor: values.themeColor.trim(),
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
        router.refresh();
        onCancel?.();
      } else {
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
          className="mb-4 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="clinic-name" className={LABEL_CLASS}>
            Clinic name
          </label>
          <input
            id="clinic-name"
            name="name"
            type="text"
            autoComplete="organization"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={Boolean(errorFor("name"))}
            aria-describedby={errorFor("name") ? "clinic-name-error" : undefined}
            className={errorFor("name") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("name") && (
            <p id="clinic-name-error" className={FIELD_ERROR_CLASS}>
              {errorFor("name")}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="clinic-address" className={LABEL_CLASS}>
            Address
          </label>
          <textarea
            id="clinic-address"
            name="address"
            rows={2}
            autoComplete="street-address"
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
            className="block w-full rounded border border-black/20 bg-transparent px-3 py-2 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60"
          />
        </div>

        <div>
          <label htmlFor="clinic-city" className={LABEL_CLASS}>
            City
          </label>
          <input
            id="clinic-city"
            name="city"
            type="text"
            autoComplete="address-level2"
            value={values.city}
            onChange={(e) => update("city", e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="clinic-theme" className={LABEL_CLASS}>
            Brand colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="clinic-theme"
              name="themeColor"
              type="text"
              inputMode="text"
              placeholder="#1D4ED8"
              value={values.themeColor}
              onChange={(e) => update("themeColor", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, themeColor: true }))}
              aria-invalid={Boolean(errorFor("themeColor"))}
              aria-describedby={
                errorFor("themeColor") ? "clinic-theme-error" : "clinic-theme-hint"
              }
              className={errorFor("themeColor") ? INPUT_INVALID_CLASS : INPUT_CLASS}
            />
            {/* Swatch, not decoration: it confirms the code entered is the colour meant. */}
            <span
              aria-hidden
              className="h-11 w-11 shrink-0 rounded border border-black/20 dark:border-white/25"
              style={{
                backgroundColor: HEX_COLOR.test(values.themeColor.trim())
                  ? values.themeColor.trim()
                  : "transparent",
              }}
            />
          </div>
          {errorFor("themeColor") ? (
            <p id="clinic-theme-error" className={FIELD_ERROR_CLASS}>
              {errorFor("themeColor")}
            </p>
          ) : (
            <p id="clinic-theme-hint" className={HINT_CLASS}>
              Optional. Used for this clinic&apos;s branding.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="clinic-logo" className={LABEL_CLASS}>
            Logo URL
          </label>
          <input
            id="clinic-logo"
            name="logoUrl"
            type="url"
            placeholder="https://…"
            value={values.logoUrl}
            onChange={(e) => update("logoUrl", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, logoUrl: true }))}
            aria-invalid={Boolean(errorFor("logoUrl"))}
            aria-describedby={errorFor("logoUrl") ? "clinic-logo-error" : undefined}
            className={errorFor("logoUrl") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("logoUrl") && (
            <p id="clinic-logo-error" className={FIELD_ERROR_CLASS}>
              {errorFor("logoUrl")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isSaving}
          className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
        >
          {isSaving
            ? isEdit
              ? "Saving…"
              : "Adding Clinic…"
            : isEdit
              ? "Save Changes"
              : "Add Clinic"}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="min-h-11 rounded border border-black/20 px-5 text-base font-medium disabled:opacity-60 dark:border-white/25"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
