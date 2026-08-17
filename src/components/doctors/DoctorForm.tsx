"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input, { Select } from "@/components/ui/Input";

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

const PHONE = /^\d{10}$/

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
    errors.phone = "Phone number must be exactly 10 digits.";
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
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {!isEdit && (
          <Select
            id="doctor-clinic"
            name="clinicId"
            label="Clinic"
            value={values.clinicId}
            onChange={(e) => update("clinicId", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, clinicId: true }))}
            error={errorFor("clinicId")}
            fieldClassName="sm:col-span-2"
          >
            <option value="">Choose a clinic…</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </Select>
        )}

        <Input
          id="doctor-name"
          name="name"
          label="Name"
          type="text"
          autoComplete="name"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={errorFor("name")}
        />

        <Input
          id="doctor-department"
          name="department"
          label="Department"
          type="text"
          value={values.department}
          onChange={(e) => update("department", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, department: true }))}
          error={errorFor("department")}
        />

        <Select
          id="doctor-gender"
          name="gender"
          label="Gender"
          value={values.gender}
          onChange={(e) => update("gender", e.target.value)}
        >
          <option value="">Not recorded</option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {gender}
            </option>
          ))}
        </Select>

        <Input
          id="doctor-age"
          name="age"
          label="Age"
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          value={values.age}
          onChange={(e) => update("age", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, age: true }))}
          error={errorFor("age")}
        />

        <Input
          id="doctor-phone"
          name="phone"
          label="Phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={10}
          value={values.phone}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            update("phone", digits);
          }}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          error={errorFor("phone")}
          hint="Optional. 10-digit number."
          fieldClassName="sm:col-span-2"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="commit"
          isBusy={isSaving}
          busyLabel={isEdit ? "Saving…" : "Adding Doctor…"}
        >
          {isEdit ? "Save Changes" : "Add Doctor"}
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
