"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input, { Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ALL_CLINICS_LABEL } from "@/components/appointments/appointmentTypeView";
import { createAppointmentTypeSchema } from "@/lib/appointmentInput";
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/lib/appointmentRules";

/**
 * Add or re-price a bookable service — AP-7, over AP-3's appointment type API.
 *
 * VALIDATION IS THE SERVER'S OWN SCHEMA, IMPORTED. The admin-dashboard-ui skill
 * asks that client validation mirror the server's zod rules, and the strongest
 * form of mirroring is not writing a second copy: this parses against
 * `createAppointmentTypeSchema` itself, so a rule changed in lib/appointmentInput.ts
 * cannot leave a stale duplicate behind here. That module is pure — zod,
 * lib/dates.ts and lib/appointmentRules.ts and nothing else — which is why a
 * client component may import it while lib/appointmentTypes.ts, which
 * re-exports the same schemas beside Prisma, stays server-only.
 *
 * THE ONE RULE THAT IS NOT THE SERVER'S is the blank-field check below. Both
 * numeric fields go through `z.coerce.number()`, and `Number("")` is 0 — a
 * legitimate value for a free service. So an empty price would validate and
 * quietly save ₹0.00. The server cannot tell the two apart by the time it has
 * JSON; the form can, and does.
 */

export interface AppointmentTypeFormValues {
  id?: string;
  /** "" = offered at every clinic in the organisation. */
  clinicId: string;
  name: string;
  durationMinutes: string;
  defaultAmount: string;
}

export interface ClinicOption {
  id: string;
  name: string;
}

interface AppointmentTypeFormProps {
  clinics: readonly ClinicOption[];
  /** Present = edit that service; absent = add a new one. */
  initial?: AppointmentTypeFormValues;
  /** Whether this actor may put a service on EVERY clinic. */
  canScopeTenantWide: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}

type Field = keyof AppointmentTypeFormValues;
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY: AppointmentTypeFormValues = {
  clinicId: "",
  name: "",
  durationMinutes: "",
  defaultAmount: "",
};

function toPayload(values: AppointmentTypeFormValues) {
  return {
    clinicId: values.clinicId.trim() === "" ? null : values.clinicId.trim(),
    name: values.name,
    durationMinutes: values.durationMinutes,
    defaultAmount: values.defaultAmount,
  };
}

function validate(values: AppointmentTypeFormValues): FieldErrors {
  const errors: FieldErrors = {};

  // Before zod, because coercion would turn both of these into 0 — see the
  // note at the top of the file.
  if (values.durationMinutes.trim() === "") {
    errors.durationMinutes = "Enter how long this service takes.";
  }
  if (values.defaultAmount.trim() === "") {
    errors.defaultAmount = "Enter a price. Use 0 for a free service.";
  }

  const parsed = createAppointmentTypeSchema.safeParse(toPayload(values));

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as Field | undefined;
      // First message per field: the reader fixes one thing at a time, and the
      // schema's own order puts the most specific rule first.
      if (field && !errors[field]) {
        errors[field] = issue.message;
      }
    }
  }

  return errors;
}

export default function AppointmentTypeForm({
  clinics,
  initial,
  canScopeTenantWide,
  onDone,
  onCancel,
}: AppointmentTypeFormProps) {
  const router = useRouter();
  const showToast = useToast();
  const isEdit = Boolean(initial?.id);

  const [values, setValues] = useState<AppointmentTypeFormValues>(
    initial ?? {
      ...EMPTY,
      // With one clinic and no tenant-wide reach there is nothing to choose.
      clinicId: !canScopeTenantWide && clinics.length === 1 ? clinics[0].id : "",
    },
  );
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const errors = validate(values);

  const update = (field: Field, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const errorFor = (field: Field) => (touched[field] ? errors[field] : undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      setTouched({
        clinicId: true,
        name: true,
        durationMinutes: true,
        defaultAmount: true,
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        clinicId: values.clinicId.trim() === "" ? null : values.clinicId.trim(),
        name: values.name.trim(),
        durationMinutes: Number(values.durationMinutes),
        defaultAmount: Number(values.defaultAmount),
      };

      const response = await fetch(
        isEdit ? `/api/appointment-types/${initial?.id}` : "/api/appointment-types",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        // The server refuses a duplicate name and a scope change that would
        // strand booked appointments, and both messages say what to do next —
        // so they are shown as written rather than replaced with a generic one.
        setFormError(body.error ?? "Could not save this service. Try again.");
        return;
      }

      showToast({
        tone: "ok",
        title: isEdit ? "Service saved." : "Service added.",
        detail: isEdit ? undefined : "It can be booked from now on.",
      });

      if (!isEdit) {
        setValues({ ...EMPTY, clinicId: values.clinicId });
        setTouched({});
      }

      router.refresh();
      onDone?.();
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
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id={`service-name-${initial?.id ?? "new"}`}
          name="name"
          label="Name"
          type="text"
          value={values.name}
          onChange={(event) => update("name", event.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={errorFor("name")}
          hint="What the desk will pick when booking — “Consultation”, “Follow-up”."
          fieldClassName="sm:col-span-2"
        />

        <Select
          id={`service-scope-${initial?.id ?? "new"}`}
          name="clinicId"
          label="Offered at"
          value={values.clinicId}
          onChange={(event) => update("clinicId", event.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, clinicId: true }))}
          error={errorFor("clinicId")}
          hint={
            isEdit
              ? "Moving a service to one clinic is refused once it has been booked elsewhere."
              : undefined
          }
        >
          {/* Only offered to someone who holds the permission tenant-wide: an
              admin scoped to one site must not add a service to every site. */}
          {canScopeTenantWide && <option value="">{ALL_CLINICS_LABEL}</option>}
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </Select>

        <Input
          id={`service-duration-${initial?.id ?? "new"}`}
          name="durationMinutes"
          label="Length in minutes"
          type="number"
          inputMode="numeric"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          step={5}
          value={values.durationMinutes}
          onChange={(event) => update("durationMinutes", event.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, durationMinutes: true }))}
          error={errorFor("durationMinutes")}
          hint={`${MIN_DURATION_MINUTES} to ${MAX_DURATION_MINUTES}. This decides how the doctor's day is divided.`}
        />

        <Input
          id={`service-amount-${initial?.id ?? "new"}`}
          name="defaultAmount"
          label="Price in rupees (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          unit="₹"
          value={values.defaultAmount}
          onChange={(event) => update("defaultAmount", event.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, defaultAmount: true }))}
          error={errorFor("defaultAmount")}
          hint="Quoted at booking. Re-pricing later never changes an appointment already booked."
          fieldClassName="sm:col-span-2"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="commit"
          isBusy={isSaving}
          busyLabel={isEdit ? "Saving…" : "Adding…"}
        >
          {isEdit ? "Save Changes" : "Add Service"}
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
