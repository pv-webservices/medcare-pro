"use client";

import { CalendarCheck, UserRoundCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatAppointmentDate } from "@/components/appointments/status";
import SlotPicker from "@/components/appointments/SlotPicker";
import PatientLookup from "@/components/registration/PatientLookup";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input, { Textarea } from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type {
  AppointmentSlotView,
  AppointmentSlotsResult,
} from "@/lib/appointments";
import { formatRupees } from "@/lib/money";
import type { PatientMatch } from "@/lib/registrations";

/**
 * Booking an appointment — AP-6, over AP-3's `createAppointment`.
 *
 * THE ORDER OF THE FORM IS THE ORDER OF THE CONVERSATION at the desk: which
 * doctor, for what, on which day, at what time, and who for. The slot is chosen
 * before the patient's details are typed, because the slot is the thing that
 * can be taken by somebody else while the form is open — and because "we have
 * nothing on Tuesday" ends the conversation before a name is worth collecting.
 *
 * NO PRICE FIELD. The amount comes from the service, on the server, and is
 * copied onto the appointment so that re-pricing the service later never
 * rewrites what a patient was quoted. It is shown here, read-only, so the desk
 * can say the number out loud — but it is never sent.
 *
 * "HAVE YOU BEEN HERE BEFORE?" IS ASKED FIRST WITHIN the patient section, using
 * the same lookup the registration form uses. Choosing an existing patient
 * links the appointment to their record, so conversion later reuses their
 * Patient ID instead of minting a second one. Booking never creates a Patient
 * and never mints a code — that is conversion's job, which keeps the code
 * sequence free of people who only ever cancelled.
 *
 * Client validation mirrors the server's zod schema; the server is still the
 * one that decides. A slot taken between loading the grid and pressing the
 * button comes back as a clean conflict, and the grid is reloaded so the desk
 * sees the new truth rather than a stale one.
 */

export interface ClinicOption {
  id: string;
  name: string;
}

export interface DoctorOption {
  id: string;
  name: string;
  department: string;
  clinicId: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  durationMinutes: number;
  /** 2-decimal string, straight off the Decimal(10,2) column. */
  defaultAmount: string;
  /** null = offered at every clinic in this organisation. */
  clinicId: string | null;
}

interface BookingFormProps {
  clinics: readonly ClinicOption[];
  doctors: readonly DoctorOption[];
  services: readonly ServiceOption[];
  /** The sidebar switcher's clinic, preselected when there is one. */
  selectedClinicId: string | null;
  /** "YYYY-MM-DD" — the day the picker opens on. */
  today: string;
}

interface FormValues {
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  date: string;
  /** "HH:mm" of the chosen slot. */
  slotStart: string;
  slotEnd: string;
  patientId: string | null;
  name: string;
  mobileNumber: string;
  age: string;
  gender: string;
  address: string;
  city: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

const GENDERS = ["Female", "Male", "Other"] as const;

/** Mirrors mobileSchema in lib/appointmentInput.ts. */
const MOBILE = /^(\+91)?[0-9]{10}$/;

function emptyForm(clinicId: string, date: string): FormValues {
  return {
    clinicId,
    doctorId: "",
    appointmentTypeId: "",
    date,
    slotStart: "",
    slotEnd: "",
    patientId: null,
    name: "",
    mobileNumber: "",
    age: "",
    gender: "",
    address: "",
    city: "",
  };
}

/**
 * "YYYY-MM-DD" + "HH:mm" → the instant the API expects.
 *
 * Tagged UTC without conversion, exactly as lib/dates.ts stores wall-clock
 * time. A clinic runs on one local clock, so converting here would put the
 * booking an offset away from the slot the desk clicked on.
 */
function toInstant(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

/** One labelled fact in the pre-booking summary. */
function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

export default function BookingForm({
  clinics,
  doctors,
  services,
  selectedClinicId,
  today,
}: BookingFormProps) {
  const router = useRouter();
  const showToast = useToast();

  const [values, setValues] = useState<FormValues>(() =>
    emptyForm(
      // With a single clinic there is nothing to choose — preselect it.
      selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : ""),
      today,
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Keyed by the query that produced it, so a grid is only ever shown for the
   * doctor, service and date currently selected. The same guard PatientLookup
   * uses, and it is what lets the effect below never call setState in its body:
   * an incomplete selection simply matches no key.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AppointmentSlotsResult;
  } | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  /** Bumped to force a reload after a lost race. */
  const [slotNonce, setSlotNonce] = useState(0);

  const clinicDoctors = doctors.filter(
    (doctor) => doctor.clinicId === values.clinicId,
  );
  // A NULL clinicId on a service means tenant-wide — the same convention
  // user_roles uses for a role that applies everywhere.
  const clinicServices = services.filter(
    (service) => service.clinicId === null || service.clinicId === values.clinicId,
  );
  const service = clinicServices.find((s) => s.id === values.appointmentTypeId);
  /** Named for the pre-booking summary, which reads back what was chosen. */
  const selectedDoctor = clinicDoctors.find(
    (doctor) => doctor.id === values.doctorId,
  );
  const selectedService = service;

  const canAskForSlots = Boolean(
    values.clinicId && values.doctorId && values.appointmentTypeId && values.date,
  );
  const slotKey = `${values.clinicId}|${values.doctorId}|${values.appointmentTypeId}|${values.date}|${slotNonce}`;
  const slots = loaded?.key === slotKey ? loaded.data : null;

  const update = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  /** Changing any of the four inputs invalidates whatever slot was chosen. */
  const updateQuery = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({
      ...current,
      [field]: value,
      slotStart: "",
      slotEnd: "",
      // The doctor list and the service list are both clinic-scoped, so moving
      // clinic cannot keep either.
      ...(field === "clinicId" ? { doctorId: "", appointmentTypeId: "" } : {}),
    }));
    setErrors((current) => ({ ...current, [field]: undefined, slotStart: undefined }));
  };

  useEffect(() => {
    if (!canAskForSlots) {
      return;
    }

    // Aborted on the next change so a slow earlier response cannot land after a
    // faster later one and show the wrong day's grid.
    const controller = new AbortController();

    (async () => {
      setIsLoadingSlots(true);
      setSlotError(null);

      const query = new URLSearchParams({
        clinicId: values.clinicId,
        doctorId: values.doctorId,
        appointmentTypeId: values.appointmentTypeId,
        date: values.date,
      });

      try {
        const response = await fetch(`/api/appointments/slots?${query}`, {
          signal: controller.signal,
        });
        const payload: {
          success?: boolean;
          data?: AppointmentSlotsResult;
          error?: string;
        } = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success || !payload.data) {
          setSlotError(payload.error ?? "Could not load slots for that day.");
          return;
        }

        setLoaded({ key: slotKey, data: payload.data });
      } catch (error: unknown) {
        if ((error as { name?: string }).name === "AbortError") return;
        setSlotError("Could not reach the server. Check your connection.");
      } finally {
        setIsLoadingSlots(false);
      }
    })();

    return () => controller.abort();
  }, [
    canAskForSlots,
    slotKey,
    values.clinicId,
    values.doctorId,
    values.appointmentTypeId,
    values.date,
  ]);

  const handlePatientSelect = useCallback((patient: PatientMatch) => {
    setValues((current) => ({
      ...current,
      patientId: patient.id,
      name: patient.name,
      mobileNumber: patient.mobileNumber,
      age: patient.age === null ? "" : String(patient.age),
      gender: patient.gender ?? "",
      address: patient.address ?? "",
      city: patient.city ?? "",
    }));
    setErrors({});
  }, []);

  function clearPatient() {
    setValues((current) => ({
      ...current,
      patientId: null,
      name: "",
      mobileNumber: "",
      age: "",
      gender: "",
      address: "",
      city: "",
    }));
  }

  function validate(): boolean {
    const next: FieldErrors = {};

    if (!values.clinicId) next.clinicId = "Choose a clinic.";
    if (!values.doctorId) next.doctorId = "Choose a doctor.";
    if (!values.appointmentTypeId) next.appointmentTypeId = "Choose a service.";
    if (!values.date) next.date = "Choose a date.";
    if (!values.slotStart) next.slotStart = "Choose a slot.";
    if (values.name.trim() === "") next.name = "Enter the patient's name.";
    if (!MOBILE.test(values.mobileNumber.trim())) {
      next.mobileNumber = "Mobile number must be a valid 10-digit Indian number.";
    }
    if (values.age !== "") {
      const age = Number(values.age);
      if (!Number.isInteger(age) || age < 0 || age > 150) {
        next.age = "Enter an age between 0 and 150.";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!validate()) return;

    setIsSaving(true);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: values.clinicId,
          doctorId: values.doctorId,
          appointmentTypeId: values.appointmentTypeId,
          patientId: values.patientId,
          name: values.name.trim(),
          mobileNumber: values.mobileNumber.trim(),
          age: values.age === "" ? null : Number(values.age),
          gender: values.gender,
          address: values.address,
          city: values.city,
          slotStart: toInstant(values.date, values.slotStart),
          slotEnd: toInstant(values.date, values.slotEnd),
          // No amount: the server takes it from the service, every time.
        }),
      });

      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        setFormError(payload.error ?? "Could not book that slot. Try again.");
        // Most likely somebody took the slot while this form was open, so the
        // grid on screen is stale. Reload it rather than leaving the desk
        // clicking a time that no longer exists.
        setValues((current) => ({ ...current, slotStart: "", slotEnd: "" }));
        setSlotNonce((n) => n + 1);
        return;
      }

      showToast({
        tone: "ok",
        title: "Appointment booked.",
        detail: `${values.name.trim()} at ${values.slotStart}.`,
      });
      router.push("/appointments");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSlot(slot: AppointmentSlotView) {
    setValues((current) => ({
      ...current,
      slotStart: slot.start,
      slotEnd: slot.end,
    }));
    setErrors((current) => ({ ...current, slotStart: undefined }));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-6" noValidate>
      <div className="space-y-4 min-w-0">
        {formError && (
          <p
            role="alert"
            className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
          >
            {formError}
          </p>
        )}

        <Panel
          title="The slot"
          description="Who is being seen, for what, and when."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
            {clinics.length > 1 && (
              <Select
                id="booking-clinic"
                label="Clinic"
                value={values.clinicId}
                error={errors.clinicId}
                onChange={(e) => updateQuery("clinicId", e.target.value)}
              >
                <option value="">Choose a clinic</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </Select>
            )}

            <Select
              id="booking-doctor"
              label="Doctor"
              value={values.doctorId}
              error={errors.doctorId}
              disabled={!values.clinicId}
              onChange={(e) => updateQuery("doctorId", e.target.value)}
            >
              <option value="">Choose a doctor</option>
              {clinicDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} — {doctor.department}
                </option>
              ))}
            </Select>

            <Select
              id="booking-service"
              label="Service"
              value={values.appointmentTypeId}
              error={errors.appointmentTypeId}
              disabled={!values.clinicId}
              onChange={(e) => updateQuery("appointmentTypeId", e.target.value)}
            >
              <option value="">Choose a service</option>
              {clinicServices.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} — {option.durationMinutes} min
                </option>
              ))}
            </Select>

            <Input
              id="booking-date"
              type="date"
              label="Date"
              value={values.date}
              error={errors.date}
              onChange={(e) => updateQuery("date", e.target.value)}
            />
          </div>

          {service && (
            <p className="mt-4 text-body text-ink">
              <span className="font-semibold">{service.name}</span>{" · "}
              <span className="font-semibold tnum">
                {service.durationMinutes} min
              </span>{" · "}
              <span className="font-semibold tnum">
                {formatRupees(service.defaultAmount)}
              </span>
            </p>
          )}

          <div className="mt-5">
            <p className="mb-2 text-body font-semibold text-ink">Slot</p>
            <SlotPicker
              result={slots}
              isLoading={isLoadingSlots}
              error={slotError}
              selected={values.slotStart}
              onSelect={handleSlot}
            />
            {errors.slotStart && (
              <p role="alert" className="mt-2 text-body font-medium text-alert-ink">
                {errors.slotStart}
              </p>
            )}
          </div>
        </Panel>

        <Panel
          title="The patient"
          description="Find them if they have been here before, so the appointment joins the record they already have."
        >
          {values.clinicId && values.patientId === null && (
            <div className="mb-5">
              <PatientLookup
                clinicId={values.clinicId}
                onSelect={handlePatientSelect}
              />
            </div>
          )}

          {values.patientId !== null && (
            <Card isFlush className="mb-5 border-accent/30 bg-accent-soft p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-body text-ink">
                  <UserRoundCheck
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="h-4 w-4 text-accent"
                  />
                  Linked to an existing patient record. No new Patient ID will be
                  created.
                </p>
                <Button size="sm" variant="ghost" onClick={clearPatient}>
                  <X aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  Book for someone else
                </Button>
              </div>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <Input
              id="booking-name"
              label="Patient name"
              autoComplete="off"
              value={values.name}
              error={errors.name}
              onChange={(e) => update("name", e.target.value)}
            />

            <Input
              id="booking-mobile"
              type="tel"
              inputMode="numeric"
              label="Mobile number"
              autoComplete="off"
              maxLength={13}
              pattern="^(\+91)?[0-9]{10}$"
              title="Enter a valid 10-digit Indian phone number (e.g. 9599995599 or +919599995599)"
              value={values.mobileNumber}
              error={errors.mobileNumber}
              onChange={(e) => {
                let val = e.target.value.replace(/[^0-9+]/g, "");
                if (val.startsWith("+")) {
                  val = val.slice(0, 13);
                } else {
                  val = val.slice(0, 10);
                }
                update("mobileNumber", val);
              }}
            />

            <Input
              id="booking-age"
              type="number"
              inputMode="numeric"
              label="Age"
              hint="Optional."
              min={0}
              max={150}
              value={values.age}
              error={errors.age}
              onChange={(e) => update("age", e.target.value)}
            />

            <Select
              id="booking-gender"
              label="Gender"
              hint="Optional."
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
              id="booking-city"
              label="City"
              hint="Optional."
              autoComplete="off"
              value={values.city}
              onChange={(e) => update("city", e.target.value)}
            />

            <Textarea
              id="booking-address"
              label="Address"
              hint="Optional."
              rows={2}
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
              fieldClassName="sm:col-span-2 lg:col-span-2"
            />
          </div>
        </Panel>
      </div>

      <div className="shrink-0 max-w-full space-y-4 lg:sticky lg:top-6 lg:mt-0 mt-2">
        <Panel
          title="Booking summary"
        >
          <dl className="flex flex-col gap-3">
            <SummaryItem
              label="Date & Time"
              value={
                values.slotStart
                  ? `${formatAppointmentDate(values.date)}, ${values.slotStart} to ${values.slotEnd}`
                  : "Not chosen"
              }
            />
            <SummaryItem label="Doctor" value={selectedDoctor?.name ?? "Not chosen"} />
            <SummaryItem
              label="Service"
              value={selectedService ? `${selectedService.name} (${formatRupees(selectedService.defaultAmount)})` : "Not chosen"}
            />
            <SummaryItem label="Patient" value={values.name.trim() || "Not entered"} />
            <SummaryItem
              label="Mobile"
              value={values.mobileNumber.trim() || "Not entered"}
            />
            <SummaryItem
              label="Record"
              value={
                values.patientId
                  ? "Existing patient"
                  : "New patient"
              }
            />
          </dl>

          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
            <Button
              type="submit"
              variant="primary"
              isBusy={isSaving}
              busyLabel="Booking…"
              className="w-full"
            >
              <CalendarCheck aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              Book appointment
            </Button>

            <Button variant="ghost" className="w-full" onClick={() => router.push("/appointments")}>
              Cancel
            </Button>
          </div>
        </Panel>
      </div>
    </form>
  );
}
