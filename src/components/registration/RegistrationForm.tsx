"use client";

import { useState, type FormEvent } from "react";
import { UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import PatientLookup from "@/components/registration/PatientLookup";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { CURRENCY_SYMBOL } from "@/lib/money";
import {
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  type PatientMatch,
  type VisitType,
} from "@/lib/registrations";
import { todayDateOnly, nowClockTime } from "@/lib/dates";

/**
 * New / edit registration — PRD §6.3 (FR-3.1, FR-3.5).
 *
 * Fields are exactly the ones the PRD names, in the order the front desk asks
 * for them: who the patient is, then what the visit was. That order is why the
 * form is two panels rather than one long column — a receptionist finishes the
 * first before the patient has finished sitting down.
 *
 * The Patient ID is not a field — it is minted server-side (FR-3.1) and shown
 * back once saved.
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

const MOBILE = /^\d{10}$/;
const MAX_AMOUNT = 99_999_999.99;

type FieldErrors = Partial<Record<keyof RegistrationFormValues, string>>;

function validate(values: RegistrationFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.clinicId) errors.clinicId = "Choose a clinic.";
  if (values.name.trim().length === 0) errors.name = "Enter the patient's name.";

  if (!MOBILE.test(values.mobileNumber.trim())) {
    errors.mobileNumber = "Mobile number must be exactly 10 digits.";
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
  const showToast = useToast();
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

  const touch = (field: keyof RegistrationFormValues) =>
    setTouched((current) => ({ ...current, [field]: true }));

  /** Only surface a field error once the user has engaged with that field. */
  const errorFor = (field: keyof RegistrationFormValues) =>
    touched[field] ? errors[field] : undefined;

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
      // Reveal every outstanding problem at once rather than one per attempt.
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
        visitDate: isEdit ? values.visitDate : todayDateOnly(),
        visitTime: isEdit ? values.visitTime : nowClockTime(),
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
        showToast({
          tone: "ok",
          title: "Changes saved.",
          // FR-3.5 / PRD §9 — the desk should know the change is on the record.
          detail: "The edit is recorded in this registration's history.",
        });
        router.refresh();
        onCancel?.();
      } else {
        showToast({
          tone: "ok",
          title: `${values.name.trim()} registered.`,
          detail: values.patientId
            ? "Added to their existing Patient ID."
            : "Their new Patient ID is on the record.",
        });
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
          className="mb-4 rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {formError}
        </p>
      )}

      <Panel
        title="Patient"
        description="Check for an existing record first — a returning patient keeps their Patient ID."
        className="mb-4"
      >
        {/* Above the lookup, because the lookup searches within a clinic. */}
        {!isEdit && clinics.length > 1 && (
          <Select
            id="registration-clinic"
            label="Clinic"
            value={values.clinicId}
            onChange={(e) => handleClinicChange(e.target.value)}
            onBlur={() => touch("clinicId")}
            error={errorFor("clinicId")}
            fieldClassName="mb-4"
          >
            <option value="">Choose a clinic…</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </Select>
        )}

        {!isEdit &&
          (values.patientId ? (
            <Card
              isFlush
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-accent-soft bg-accent-soft p-4"
            >
              <p className="flex items-center gap-2 text-body text-ink">
                <UserRoundCheck
                  aria-hidden="true"
                  strokeWidth={2}
                  className="h-4 w-4 shrink-0 text-accent"
                />
                <span>
                  Follow-up visit for{" "}
                  <span className="font-semibold">{values.name}</span>{" "}
                  <span className="serial text-muted">({values.patientCode})</span>
                  . Their existing Patient ID is kept.
                </span>
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={handlePatientClear}
              >
                Register as new patient
              </Button>
            </Card>
          ) : (
            <div className="mb-4">
              <PatientLookup
                clinicId={values.clinicId}
                onSelect={handlePatientSelect}
              />
            </div>
          ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="registration-name"
            type="text"
            label="Patient name"
            autoComplete="off"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            onBlur={() => touch("name")}
            error={errorFor("name")}
          />

          <Input
            id="registration-mobile"
            type="tel"
            inputMode="numeric"
            label="Mobile number"
            autoComplete="off"
            maxLength={10}
            value={values.mobileNumber}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              update("mobileNumber", digits);
            }}
            onBlur={() => touch("mobileNumber")}
            error={errorFor("mobileNumber")}
          />

          <Input
            id="registration-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={150}
            label="Age (optional)"
            value={values.age}
            onChange={(e) => update("age", e.target.value)}
            onBlur={() => touch("age")}
            error={errorFor("age")}
          />

          <Select
            id="registration-gender"
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
            id="registration-address"
            type="text"
            label="Address (optional)"
            autoComplete="off"
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
            fieldClassName="sm:col-span-2"
          />

          <Input
            id="registration-city"
            type="text"
            label="City (optional)"
            autoComplete="off"
            value={values.city}
            onChange={(e) => update("city", e.target.value)}
          />
        </div>
      </Panel>

      <Panel
        title="Visit"
        description="What happened at the desk today, and what it came to."
        className="mb-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="registration-visit-type"
            label="Visit type"
            value={values.visitType}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                visitType: e.target.value as VisitType,
              }))
            }
            // Derived from the patient lookup, but the desk can override:
            // a returning patient with a new complaint is a new case.
            hint="Set automatically when you pick an existing patient — change it if this visit is for something new."
            fieldClassName="sm:col-span-2"
          >
            {VISIT_TYPES.map((visitType) => (
              <option key={visitType} value={visitType}>
                {VISIT_TYPE_LABELS[visitType]}
              </option>
            ))}
          </Select>

          <Select
            id="registration-doctor"
            label="Doctor (optional)"
            value={values.doctorId}
            onChange={(e) => handleDoctorChange(e.target.value)}
            disabled={!values.clinicId}
            hint={
              values.clinicId && clinicDoctors.length === 0
                ? "No doctors added for this clinic yet."
                : undefined
            }
          >
            <option value="">Not assigned yet</option>
            {clinicDoctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name} · {doctor.department}
              </option>
            ))}
          </Select>

          <div>
            <Input
              id="registration-department"
              type="text"
              label="Department"
              list="registration-departments"
              autoComplete="off"
              value={values.department}
              onChange={(e) => update("department", e.target.value)}
              onBlur={() => touch("department")}
              error={errorFor("department")}
            />
            <datalist id="registration-departments">
              {departments.map((department) => (
                <option key={department} value={department} />
              ))}
            </datalist>
          </div>

          <Input
            id="registration-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            label={`Amount (${CURRENCY_SYMBOL})`}
            unit={CURRENCY_SYMBOL}
            value={values.amount}
            onChange={(e) => update("amount", e.target.value)}
            onBlur={() => touch("amount")}
            error={errorFor("amount")}
          />
        </div>
      </Panel>

      {!isEdit && values.patientId === "" && (
        <p className="mb-4 text-meta text-muted">
          A Patient ID is assigned automatically when you save.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="primary"
          isBusy={isSaving}
          busyLabel={isEdit ? "Saving…" : "Registering…"}
        >
          {isEdit ? "Save changes" : "Register patient"}
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
