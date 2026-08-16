"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PatientLookup from "@/components/registration/PatientLookup";
import { CURRENCY_SYMBOL } from "@/lib/money";
import {
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  type PatientMatch,
  type VisitType,
} from "@/lib/registrations";

/**
 * New / edit registration — PRD §6.3 (FR-3.1, FR-3.5).
 *
 * Fields are exactly the ones the PRD names, in the order the front desk asks
 * for them: who the patient is, then what the visit was. The Patient ID is not
 * a field — it is minted server-side (FR-3.1) and shown back once saved.
 *
 * Validation runs as the person types, so a mistyped mobile number is flagged
 * before they reach the button. The server stays authoritative: these rules
 * mirror the zod schemas in src/lib/registrations.ts.
 */

export interface ClinicOption {
  id: string;
  name: string;
}

export interface DoctorOption {
  id: string;
  name: string;
  clinicId: string;
  department: string;
}

export interface RegistrationFormValues {
  clinicId: string;
  /** Set once an existing patient is picked — this visit joins their record. */
  patientId: string;
  /** Display only, so the form can show whose record is being added to. */
  patientCode: string;
  name: string;
  age: string;
  gender: string;
  mobileNumber: string;
  address: string;
  city: string;
  doctorId: string;
  department: string;
  amount: string;
  visitDate: string;
  visitTime: string;
  visitType: VisitType;
}

interface RegistrationFormProps {
  clinics: readonly ClinicOption[];
  doctors: readonly DoctorOption[];
  /** Known departments, offered as suggestions — the field stays free text. */
  departments: readonly string[];
  /**
   * "Now" for a new visit, as YYYY-MM-DD and HH:mm.
   *
   * Both come from the server so the markup is identical either side of
   * hydration. That makes the deployment's clock the clinic's clock — set `TZ`
   * on the host (e.g. Asia/Kolkata) or a late-evening registration will default
   * to the wrong day.
   */
  today: string;
  now: string;
  /** Present = edit an existing registration; absent = record a new one. */
  registrationId?: string;
  initial?: RegistrationFormValues;
  onCancel?: () => void;
}

/** Free text in the database — this list is a shortcut, not a constraint. */
const GENDERS = ["Female", "Male", "Other"] as const;

const MOBILE = /^[+()\d][\d\s()-]{4,24}$/;
const MAX_AMOUNT = 99_999_999.99;

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";
const INPUT_INVALID_CLASS =
  "block min-h-11 w-full rounded border border-red-600 bg-transparent px-3 text-base outline-none dark:border-red-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium";
const FIELD_ERROR_CLASS = "mt-1 text-xs text-red-700 dark:text-red-400";
const SECTION_CLASS = "mb-6 rounded border border-black/15 p-4 dark:border-white/20";

type FieldErrors = Partial<Record<keyof RegistrationFormValues, string>>;

function validate(values: RegistrationFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.clinicId) errors.clinicId = "Choose a clinic.";
  if (values.name.trim().length === 0) errors.name = "Enter the patient's name.";

  if (!MOBILE.test(values.mobileNumber.trim())) {
    errors.mobileNumber = "Enter a valid mobile number.";
  }

  if (values.age.trim()) {
    const age = Number(values.age);
    if (!Number.isInteger(age) || age < 0 || age > 150) {
      errors.age = "Enter an age between 0 and 150.";
    }
  }

  if (values.department.trim().length === 0) {
    // FR-3.1 marks department as required, unlike the doctor.
    errors.department = "Department is required.";
  }

  const amount = Number(values.amount);
  if (values.amount.trim() === "" || !Number.isFinite(amount)) {
    errors.amount = "Enter the amount.";
  } else if (amount < 0) {
    errors.amount = "The amount cannot be negative.";
  } else if (amount > MAX_AMOUNT) {
    errors.amount = "That amount is too large.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.visitDate)) {
    errors.visitDate = "Choose a valid visit date.";
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.visitTime)) {
    errors.visitTime = "Use a 24-hour time like 14:30.";
  }

  return errors;
}

export function emptyRegistration(
  today: string,
  now: string,
  clinicId: string,
): RegistrationFormValues {
  return {
    clinicId,
    patientId: "",
    patientCode: "",
    name: "",
    age: "",
    gender: "",
    mobileNumber: "",
    address: "",
    city: "",
    doctorId: "",
    department: "",
    amount: "",
    visitDate: today,
    visitTime: now,
    visitType: "NEW",
  };
}

export default function RegistrationForm({
  clinics,
  doctors,
  departments,
  today,
  now,
  registrationId,
  initial,
  onCancel,
}: RegistrationFormProps) {
  const router = useRouter();
  const isEdit = Boolean(registrationId);

  const [values, setValues] = useState<RegistrationFormValues>(
    initial ??
      // With a single clinic there is nothing to choose — preselect it.
      emptyRegistration(today, now, clinics.length === 1 ? clinics[0].id : ""),
  );
  const [touched, setTouched] = useState<
    Partial<Record<keyof RegistrationFormValues, boolean>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const errors = validate(values);
  const clinicDoctors = doctors.filter(
    (doctor) => doctor.clinicId === values.clinicId,
  );

  const update = (field: keyof RegistrationFormValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const errorFor = (field: keyof RegistrationFormValues) =>
    touched[field] ? errors[field] : undefined;

  const inputClass = (field: keyof RegistrationFormValues) =>
    errorFor(field) ? INPUT_INVALID_CLASS : INPUT_CLASS;

  /**
   * Changing clinic invalidates the doctor and any selected patient — both
   * belong to the old clinic.
   */
  function handleClinicChange(clinicId: string) {
    setValues((current) => ({
      ...current,
      clinicId,
      doctorId: "",
      patientId: "",
      patientCode: "",
    }));
  }

  /**
   * A returning patient: their record is joined rather than duplicated, their
   * details are pre-filled (still editable — this is when a new address gets
   * captured), and the visit is marked a follow-up.
   */
  function handlePatientSelect(patient: PatientMatch) {
    setValues((current) => ({
      ...current,
      patientId: patient.id,
      patientCode: patient.patientCode,
      name: patient.name,
      age: patient.age === null ? "" : String(patient.age),
      gender: patient.gender ?? "",
      mobileNumber: patient.mobileNumber,
      address: patient.address ?? "",
      city: patient.city ?? "",
      visitType: "FOLLOW_UP",
    }));
  }

  /** Back to a blank new patient, leaving the visit details as entered. */
  function handlePatientClear() {
    setValues((current) => ({
      ...current,
      patientId: "",
      patientCode: "",
      name: "",
      age: "",
      gender: "",
      mobileNumber: "",
      address: "",
      city: "",
      visitType: "NEW",
    }));
  }

  /** Pre-fill the department from the doctor — it is what they practise. */
  function handleDoctorChange(doctorId: string) {
    const doctor = doctors.find((entry) => entry.id === doctorId);

    setValues((current) => ({
      ...current,
      doctorId,
      department:
        doctor && current.department.trim() === ""
          ? doctor.department
          : current.department,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      setTouched({
        clinicId: true,
        name: true,
        age: true,
        gender: true,
        mobileNumber: true,
        address: true,
        city: true,
        doctorId: true,
        department: true,
        amount: true,
        visitDate: true,
        visitTime: true,
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: values.name.trim(),
        age: values.age.trim() === "" ? null : Number(values.age),
        gender: values.gender.trim(),
        mobileNumber: values.mobileNumber.trim(),
        address: values.address.trim(),
        city: values.city.trim(),
        doctorId: values.doctorId === "" ? null : values.doctorId,
        department: values.department.trim(),
        amount: Number(values.amount),
        visitDate: values.visitDate,
        visitTime: values.visitTime,
        visitType: values.visitType,
        // The clinic is fixed after creation — moving a visit between clinics
        // would move its revenue with it. So is the patient: re-pointing a
        // visit at a different person is a new registration, not an edit.
        ...(isEdit
          ? {}
          : {
              clinicId: values.clinicId,
              patientId: values.patientId === "" ? null : values.patientId,
            }),
      };

      const response = await fetch(
        isEdit ? `/api/registrations/${registrationId}` : "/api/registrations",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const body: { success?: boolean; error?: string; data?: { id: string } } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setFormError(
          body.error ?? "Could not save the registration. Try again.",
        );
        return;
      }

      if (isEdit) {
        router.refresh();
        onCancel?.();
      } else {
        // Straight to the record, where the new Patient ID is shown.
        router.push(`/registration/${body.data?.id ?? ""}`);
        router.refresh();
      }
    } catch {
      setFormError(
        "Could not reach the server. Check your connection and try again.",
      );
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

      <section className={SECTION_CLASS} aria-labelledby="patient-heading">
        <h2 id="patient-heading" className="mb-4 text-lg font-semibold">
          Patient
        </h2>

        {/* Above the lookup, because the lookup searches within a clinic. */}
        {!isEdit && clinics.length > 1 && (
          <div className="mb-4">
            <label htmlFor="registration-clinic" className={LABEL_CLASS}>
              Clinic
            </label>
            <select
              id="registration-clinic"
              value={values.clinicId}
              onChange={(e) => handleClinicChange(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, clinicId: true }))}
              aria-invalid={Boolean(errorFor("clinicId"))}
              className={inputClass("clinicId")}
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

        {!isEdit &&
          (values.patientId ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-black/15 bg-black/[0.03] px-3 py-2 dark:border-white/20 dark:bg-white/[0.06]">
              <p className="text-sm">
                Adding a visit to{" "}
                <span className="font-medium">{values.name}</span>{" "}
                <span className="tabular-nums text-black/55 dark:text-white/55">
                  ({values.patientCode})
                </span>
                . Their existing Patient ID is kept.
              </p>
              <button
                type="button"
                onClick={handlePatientClear}
                className="min-h-11 shrink-0 rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
              >
                Register as new patient
              </button>
            </div>
          ) : (
            <div className="mb-4">
              <PatientLookup
                clinicId={values.clinicId}
                onSelect={handlePatientSelect}
              />
            </div>
          ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="registration-name" className={LABEL_CLASS}>
              Patient name
            </label>
            <input
              id="registration-name"
              type="text"
              autoComplete="off"
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              aria-invalid={Boolean(errorFor("name"))}
              className={inputClass("name")}
            />
            {errorFor("name") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("name")}</p>
            )}
          </div>

          <div>
            <label htmlFor="registration-mobile" className={LABEL_CLASS}>
              Mobile number
            </label>
            <input
              id="registration-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={values.mobileNumber}
              onChange={(e) => update("mobileNumber", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, mobileNumber: true }))}
              aria-invalid={Boolean(errorFor("mobileNumber"))}
              className={inputClass("mobileNumber")}
            />
            {errorFor("mobileNumber") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("mobileNumber")}</p>
            )}
          </div>

          <div>
            <label htmlFor="registration-age" className={LABEL_CLASS}>
              Age{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                (optional)
              </span>
            </label>
            <input
              id="registration-age"
              type="number"
              inputMode="numeric"
              min={0}
              max={150}
              value={values.age}
              onChange={(e) => update("age", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, age: true }))}
              aria-invalid={Boolean(errorFor("age"))}
              className={inputClass("age")}
            />
            {errorFor("age") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("age")}</p>
            )}
          </div>

          <div>
            <label htmlFor="registration-gender" className={LABEL_CLASS}>
              Gender
            </label>
            <select
              id="registration-gender"
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

          <div className="sm:col-span-2">
            <label htmlFor="registration-address" className={LABEL_CLASS}>
              Address{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                (optional)
              </span>
            </label>
            <input
              id="registration-address"
              type="text"
              autoComplete="off"
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="registration-city" className={LABEL_CLASS}>
              City{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                (optional)
              </span>
            </label>
            <input
              id="registration-city"
              type="text"
              autoComplete="off"
              value={values.city}
              onChange={(e) => update("city", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      <section className={SECTION_CLASS} aria-labelledby="visit-heading">
        <h2 id="visit-heading" className="mb-4 text-lg font-semibold">
          Visit
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="registration-visit-type" className={LABEL_CLASS}>
              Visit type
            </label>
            <select
              id="registration-visit-type"
              value={values.visitType}
              onChange={(e) =>
                setValues((current) => ({
                  ...current,
                  visitType: e.target.value as VisitType,
                }))
              }
              className={INPUT_CLASS}
            >
              {VISIT_TYPES.map((visitType) => (
                <option key={visitType} value={visitType}>
                  {VISIT_TYPE_LABELS[visitType]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-black/55 dark:text-white/55">
              {/* Derived from the patient lookup, but the desk can override:
                  a returning patient with a new complaint is a new case. */}
              Set automatically when you pick an existing patient — change it if
              this visit is for something new.
            </p>
          </div>

          <div>
            <label htmlFor="registration-doctor" className={LABEL_CLASS}>
              Doctor{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                (optional)
              </span>
            </label>
            <select
              id="registration-doctor"
              value={values.doctorId}
              onChange={(e) => handleDoctorChange(e.target.value)}
              disabled={!values.clinicId}
              className={INPUT_CLASS}
            >
              <option value="">Not assigned yet</option>
              {clinicDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} · {doctor.department}
                </option>
              ))}
            </select>
            {values.clinicId && clinicDoctors.length === 0 && (
              <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                No doctors added for this clinic yet.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="registration-department" className={LABEL_CLASS}>
              Department
            </label>
            <input
              id="registration-department"
              type="text"
              list="registration-departments"
              autoComplete="off"
              value={values.department}
              onChange={(e) => update("department", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, department: true }))}
              aria-invalid={Boolean(errorFor("department"))}
              className={inputClass("department")}
            />
            <datalist id="registration-departments">
              {departments.map((department) => (
                <option key={department} value={department} />
              ))}
            </datalist>
            {errorFor("department") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("department")}</p>
            )}
          </div>

          <div>
            <label htmlFor="registration-amount" className={LABEL_CLASS}>
              Amount
            </label>
            <div className="flex items-stretch">
              <span
                aria-hidden="true"
                className="flex min-h-11 items-center rounded-l border border-r-0 border-black/20 px-3 text-base text-black/60 dark:border-white/25 dark:text-white/60"
              >
                {CURRENCY_SYMBOL}
              </span>
              <input
                id="registration-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={values.amount}
                onChange={(e) => update("amount", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
                aria-invalid={Boolean(errorFor("amount"))}
                className={`${inputClass("amount")} rounded-l-none`}
              />
            </div>
            {errorFor("amount") && (
              <p className={FIELD_ERROR_CLASS}>{errorFor("amount")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="registration-date" className={LABEL_CLASS}>
                Visit date
              </label>
              <input
                id="registration-date"
                type="date"
                value={values.visitDate}
                onChange={(e) => update("visitDate", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, visitDate: true }))}
                aria-invalid={Boolean(errorFor("visitDate"))}
                className={inputClass("visitDate")}
              />
              {errorFor("visitDate") && (
                <p className={FIELD_ERROR_CLASS}>{errorFor("visitDate")}</p>
              )}
            </div>

            <div>
              <label htmlFor="registration-time" className={LABEL_CLASS}>
                Visit time
              </label>
              <input
                id="registration-time"
                type="time"
                value={values.visitTime}
                onChange={(e) => update("visitTime", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, visitTime: true }))}
                aria-invalid={Boolean(errorFor("visitTime"))}
                className={inputClass("visitTime")}
              />
              {errorFor("visitTime") && (
                <p className={FIELD_ERROR_CLASS}>{errorFor("visitTime")}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {!isEdit && values.patientId === "" && (
        <p className="mb-4 text-sm text-black/55 dark:text-white/55">
          A Patient ID is assigned automatically when you save.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isSaving}
          className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
        >
          {isSaving
            ? isEdit
              ? "Saving…"
              : "Registering…"
            : isEdit
              ? "Save Changes"
              : "Register Patient"}
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
