"use client";

import { useState, type FormEvent } from "react";
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
  const showToast = useToast();
  const isEdit = Boolean(initial?.id);

  const [values, setValues] = useState<ClinicFormValues>(initial ?? EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof ClinicFormValues, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;
  const swatch = values.themeColor.trim();

  function update(field: keyof ClinicFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function touch(field: keyof ClinicFormValues) {
    setTouched((current) => ({ ...current, [field]: true }));
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
          className="mb-4 rounded-md border border-alert/40 bg-alert/8 px-3 py-2.5 text-body text-alert"
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

        <Input
          id="clinic-theme"
          name="themeColor"
          label="Brand colour"
          type="text"
          placeholder="#1D4ED8"
          value={values.themeColor}
          onChange={(e) => update("themeColor", e.target.value)}
          onBlur={() => touch("themeColor")}
          error={errorFor("themeColor")}
          hint="Optional. Marks this clinic throughout the app."
          adornment={
            // A swatch, not decoration: it confirms the code typed is the
            // colour meant, and previews the rail this clinic will wear.
            <span
              aria-hidden="true"
              className="h-11 w-11 shrink-0 rounded-md border border-line"
              style={{
                backgroundColor: HEX_COLOR.test(swatch) ? swatch : "transparent",
              }}
            />
          }
        />

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
          fieldClassName="sm:col-span-2"
        />
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
