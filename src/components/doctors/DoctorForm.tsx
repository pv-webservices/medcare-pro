"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Add/edit a doctor — PRD §6.4 (FR-4.2).
 *
 * Fields are exactly those the PRD names: Name, Department, Gender, Age, Phone
 * (optional), Clinic Location. Validation runs as the user types so a bad age
 * or phone number is flagged before they reach the button.
 */

export interface DoctorFormValues {
  id?: string;
  clinicId: string;
  name: string;
  department: string;
  gender: string;
  age: string;
  phone: string;
}

export interface ClinicOption {
  id: string;
  name: string;
}

interface DoctorFormProps {
  clinics: readonly ClinicOption[];
  /** Present = edit an existing doctor; absent = add a new one. */
  initial?: DoctorFormValues;
  onCancel?: () => void;
}

/** Free text in the database — this list is a shortcut, not a constraint. */
const GENDERS = ["Female", "Male", "Other"] as const;

const PHONE = /^[+()\d][\d\s()-]{4,24}$/;

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";
const INPUT_INVALID_CLASS =
  "block min-h-11 w-full rounded border border-red-600 bg-transparent px-3 text-base outline-none dark:border-red-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium";
const FIELD_ERROR_CLASS = "mt-1 text-xs text-red-700 dark:text-red-400";

type FieldErrors = Partial<Record<keyof DoctorFormValues, string>>;

/** Mirrors the zod rules in src/lib/doctors.ts — the server stays authoritative. */
function validate(values: DoctorFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.clinicId) errors.clinicId = "Choose a clinic.";
  if (values.name.trim().length === 0) errors.name = "Enter the doctor's name.";
  if (values.department.trim().length === 0) {
    errors.department = "Enter a department.";
  }

  if (values.age.trim()) {
    const age = Number(values.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      errors.age = "Enter an age between 0 and 120.";
    }
  }

  if (values.phone.trim() && !PHONE.test(values.phone.trim())) {
    errors.phone = "Enter a valid phone number.";
  }

  return errors;
}

export default function DoctorForm({ clinics, initial, onCancel }: DoctorFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [values, setValues] = useState<DoctorFormValues>(
    initial ?? {
      // With a single clinic there is nothing to choose — preselect it.
      clinicId: clinics.length === 1 ? clinics[0].id : "",
      name: "",
      department: "",
      gender: "",
      age: "",
      phone: "",
    },
  );
  const [touched, setTouched] = useState<Partial<Record<keyof DoctorFormValues, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const errors = validate(values);

  const update = (field: keyof DoctorFormValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const errorFor = (field: keyof DoctorFormValues) =>
    touched[field] ? errors[field] : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      setTouched({
        clinicId: true,
        name: true,
        department: true,
        gender: true,
        age: true,
        phone: true,
      });
      return;
    }

    setIsSaving(true);
    try {
      // Clinic is fixed after creation — see the note in the API route.
      const payload = {
        name: values.name.trim(),
        department: values.department.trim(),
        gender: values.gender.trim(),
        age: values.age.trim() === "" ? null : Number(values.age),
        phone: values.phone.trim(),
        ...(isEdit ? {} : { clinicId: values.clinicId }),
      };

      const response = await fetch(
        isEdit ? `/api/doctors/${initial?.id}` : "/api/doctors",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const body: { success?: boolean; error?: string; data?: { id: string } } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setFormError(body.error ?? "Could not save the doctor. Try again.");
        return;
      }

      if (isEdit) {
        router.refresh();
        onCancel?.();
      } else {
        // Straight to the profile — the next task is setting availability.
        router.push(`/doctors/${body.data?.id ?? ""}`);
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
        {!isEdit && (
          <div className="sm:col-span-2">
            <label htmlFor="doctor-clinic" className={LABEL_CLASS}>
              Clinic
            </label>
            <select
              id="doctor-clinic"
              value={values.clinicId}
              onChange={(e) => update("clinicId", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, clinicId: true }))}
              aria-invalid={Boolean(errorFor("clinicId"))}
              className={errorFor("clinicId") ? INPUT_INVALID_CLASS : INPUT_CLASS}
            >
              <option value="">Choose a clinic…</option>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
            {errorFor("clinicId") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("clinicId")}</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="doctor-name" className={LABEL_CLASS}>
            Name
          </label>
          <input
            id="doctor-name"
            type="text"
            autoComplete="name"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={Boolean(errorFor("name"))}
            className={errorFor("name") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("name") && <p className={FIELD_ERROR_CLASS}>{errorFor("name")}</p>}
        </div>

        <div>
          <label htmlFor="doctor-department" className={LABEL_CLASS}>
            Department
          </label>
          <input
            id="doctor-department"
            type="text"
            value={values.department}
            onChange={(e) => update("department", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, department: true }))}
            aria-invalid={Boolean(errorFor("department"))}
            className={errorFor("department") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("department") && (
            <p className={FIELD_ERROR_CLASS}>{errorFor("department")}</p>
          )}
        </div>

        <div>
          <label htmlFor="doctor-gender" className={LABEL_CLASS}>
            Gender
          </label>
          <select
            id="doctor-gender"
            value={values.gender}
            onChange={(e) => update("gender", e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Not recorded</option>
            {GENDERS.map((gender) => (
              <option key={gender} value={gender}>
                {gender}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="doctor-age" className={LABEL_CLASS}>
            Age
          </label>
          <input
            id="doctor-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            value={values.age}
            onChange={(e) => update("age", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, age: true }))}
            aria-invalid={Boolean(errorFor("age"))}
            className={errorFor("age") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("age") && <p className={FIELD_ERROR_CLASS}>{errorFor("age")}</p>}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="doctor-phone" className={LABEL_CLASS}>
            Phone <span className="font-normal text-black/55 dark:text-white/55">(optional)</span>
          </label>
          <input
            id="doctor-phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(e) => update("phone", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            aria-invalid={Boolean(errorFor("phone"))}
            className={errorFor("phone") ? INPUT_INVALID_CLASS : INPUT_CLASS}
          />
          {errorFor("phone") && <p className={FIELD_ERROR_CLASS}>{errorFor("phone")}</p>}
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
              : "Adding Doctor…"
            : isEdit
              ? "Save Changes"
              : "Add Doctor"}
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
