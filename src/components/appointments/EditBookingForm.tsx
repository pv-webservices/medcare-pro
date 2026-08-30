"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input, { Textarea } from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { updateAppointmentSchema } from "@/lib/appointmentInput";

/**
 * Correcting a booking's details — AP-9, over PATCH /api/appointments/[id].
 *
 * WHAT IS NOT ON THIS FORM IS THE POINT, and it is the same list the endpoint
 * refuses to have vocabulary for: no date, no time, no doctor, no service, no
 * clinic, no patient link and no status. Moving a booking is the reschedule
 * form further down the same page, which picks a real free slot; this only
 * corrects what the desk wrote down about the person.
 *
 * VALIDATION IS THE SERVER'S OWN SCHEMA, IMPORTED — the AP-7 pattern, for the
 * same reason: the strongest form of mirroring the server's rules is not
 * writing a second copy. `updateAppointmentSchema` lives in the pure
 * lib/appointmentInput.ts, so a client component may import it while
 * lib/appointmentEdit.ts, which sits beside Prisma, stays server-only.
 *
 * TWO RULES ARE THE FORM'S OWN, because the server cannot see them by the time
 * it has JSON:
 *
 *   - A blank AMOUNT would go through `z.coerce.number()` as 0, which is a
 *     legitimate price for a free follow-up. Blank means "I cleared the field",
 *     not "make it free", so it is refused here.
 *   - A blank AGE is genuinely "not recorded", so it is sent as an explicit
 *     null rather than the 0 that coercion would produce — a newborn is 0 and
 *     the two must not collide.
 */

const GENDERS = ["Female", "Male", "Other"] as const;

export interface EditBookingValues {
  name: string;
  mobileNumber: string;
  /** Strings throughout: these are form controls, not the stored types. */
  age: string;
  gender: string;
  city: string;
  address: string;
  amount: string;
}

interface EditBookingFormProps {
  appointmentId: string;
  initial: EditBookingValues;
}

type Field = keyof EditBookingValues;
type FieldErrors = Partial<Record<Field, string>>;

/** The JSON body, with the two coercion traps handled before zod sees them. */
function toPayload(values: EditBookingValues) {
  return {
    name: values.name,
    mobileNumber: values.mobileNumber,
    age: values.age.trim() === "" ? null : Number(values.age),
    gender: values.gender,
    city: values.city,
    address: values.address,
    amount: Number(values.amount),
  };
}

function validate(values: EditBookingValues): FieldErrors {
  const errors: FieldErrors = {};

  // Before zod, because coercion would turn this into a free consultation.
  if (values.amount.trim() === "") {
    errors.amount = "Enter an amount. Use 0 if this visit is free.";
  }

  const parsed = updateAppointmentSchema.safeParse(toPayload(values));

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as Field | undefined;
      if (field && !errors[field]) {
        errors[field] = issue.message;
      }
    }
  }

  return errors;
}

export default function EditBookingForm({
  appointmentId,
  initial,
}: EditBookingFormProps) {
  const router = useRouter();
  const showToast = useToast();

  const [values, setValues] = useState<EditBookingValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  // The server refuses a save that changes nothing, with a message saying so.
  // This is the courtesy layer on top of that: nobody should be offered a
  // button whose only outcome is a refusal.
  const isDirty = (Object.keys(initial) as Field[]).some(
    (field) => values[field] !== initial[field],
  );

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(values)),
      });

      const body: {
        success?: boolean;
        error?: string;
        data?: { changedFields?: string[] };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        // The server's message names the state the booking is actually in —
        // "already been registered as a visit", and where to correct it
        // instead — which reads better than anything invented here.
        showToast({
          tone: "alert",
          title: "That correction did not save.",
          detail: body.error ?? "Try again in a moment.",
        });
        return;
      }

      const changed = body.data?.changedFields ?? [];
      showToast({
        tone: "ok",
        title: "Booking corrected.",
        detail:
          changed.length > 0
            ? `Updated: ${changed.join(",")}.`
            : "The booking is up to date.",
      });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server.",
        detail: "Check your connection and try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          id="edit-booking-name"
          name="name"
          label="Patient name"
          autoComplete="off"
          value={values.name}
          error={errors.name}
          onChange={(event) => update("name", event.target.value)}
        />

        <Input
          id="edit-booking-mobile"
          name="mobileNumber"
          type="tel"
          inputMode="numeric"
          label="Mobile number"
          autoComplete="off"
          maxLength={13}
          pattern="^(\+91)?[0-9]{10}$"
          title="Enter a valid 10-digit Indian phone number (e.g. 9599995599 or +919599995599)"
          value={values.mobileNumber}
          error={errors.mobileNumber}
          onChange={(event) => {
            let val = event.target.value.replace(/[^0-9+]/g, "");
            if (val.startsWith("+")) {
              val = val.slice(0, 13);
            } else {
              val = val.slice(0, 10);
            }
            update("mobileNumber", val);
          }}
        />

        <Input
          id="edit-booking-amount"
          name="amount"
          label="Amount quoted (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          unit="₹"
          value={values.amount}
          error={errors.amount}
          onChange={(event) => update("amount", event.target.value)}
        />

        <Input
          id="edit-booking-age"
          name="age"
          type="number"
          inputMode="numeric"
          label="Age"
          hint="Optional."
          min={0}
          max={150}
          value={values.age}
          error={errors.age}
          onChange={(event) => update("age", event.target.value)}
        />

        <Select
          id="edit-booking-gender"
          name="gender"
          label="Gender"
          hint="Optional."
          value={values.gender}
          onChange={(event) => update("gender", event.target.value)}
        >
          <option value="">Not recorded</option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {gender}
            </option>
          ))}
        </Select>

        <Input
          id="edit-booking-city"
          name="city"
          label="City"
          hint="Optional."
          autoComplete="off"
          value={values.city}
          error={errors.city}
          onChange={(event) => update("city", event.target.value)}
        />

        <Input
          id="edit-booking-address"
          name="address"
          label="Address"
          hint="Optional."
          autoComplete="off"
          value={values.address}
          error={errors.address}
          onChange={(event) => update("address", event.target.value)}
          fieldClassName="sm:col-span-2 lg:col-span-3"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={!isDirty}
          isBusy={isSaving}
          busyLabel="Saving…"
          className="rounded-xl px-4 py-2 font-medium shadow-cta"
        >
          Save corrections
        </Button>

        {isDirty ? (
          <Button
            type="button"
            variant="ghost"
            disabled={isSaving}
            onClick={() => {
              setValues(initial);
              setErrors({});
            }}
            className="rounded-xl font-medium"
          >
            Discard changes
          </Button>
        ) : (
          <p className="text-label text-muted">
            Nothing has been changed yet.
          </p>
        )}
      </div>
    </form>
  );
}
