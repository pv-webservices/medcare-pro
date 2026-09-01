import { TelephonyBookingRequestReason } from "@prisma/client";
import {
  buildPhoneBookingSourceRef,
  createAppointmentForScope,
  getPhoneIvrAppointmentForCall,
} from "@/lib/appointmentBooking";
import {
  getAppointmentDoctorForScope,
  getAppointmentSlotsForScope,
  listAppointmentDoctorsForClinic,
  listAppointmentTypesForClinic,
  type AppointmentSlotsResult,
} from "@/lib/appointmentAvailability";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { parseDateTime, tomorrowDateOnlyInTimeZone } from "@/lib/dates";
import { ScopeError } from "@/lib/rbac";
import {
  callbackReasonForResolution,
  createTelephonyBookingRequest,
  normalizePlivoCallUuid,
  resolveTelephonePatient,
  type TelephonePatient,
} from "@/lib/telephony/bookingIdentity";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  IVR_LIST_PAGE_SIZE,
  IVR_SLOT_PAGE_SIZE,
  formatClockTimeForSpeech,
  paginateIvrItems,
} from "@/lib/telephony/ivr";
import {
  buildAppointmentTypeSelectionXml,
  buildBookingSlotSelectionXml,
  buildDoctorSelectionXml,
  buildEffectiveClinicMainMenuXml,
  buildFinalBookingConfirmationXml,
  buildPatientConfirmationXml,
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
  PLIVO_BOOKING_CONFIRM_WEBHOOK_PATH,
  PLIVO_BOOKING_DOCTOR_WEBHOOK_PATH,
  PLIVO_BOOKING_IDENTITY_WEBHOOK_PATH,
  PLIVO_BOOKING_SLOTS_WEBHOOK_PATH,
  PLIVO_BOOKING_TYPE_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";
import { parseSignedIdState, parseSignedPageState } from "@/lib/telephony/availability";
import type { ClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

interface BookingCallInput {
  requestUrl: string;
  clinic: InboundClinicContext;
  from: unknown;
  callUuid: unknown;
  digits?: string;
  now?: Date;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}

function mainMenu(
  input: Pick<BookingCallInput, "requestUrl" | "clinic" | "runtimeMenu">,
): string {
  return buildEffectiveClinicMainMenuXml({
    inputActionUrl: buildPlivoInputActionUrl(input.requestUrl),
    clinicName: input.clinic.clinicName,
    runtimeMenu: input.runtimeMenu,
  });
}

function messageThenMainMenu(
  message: string,
  input: Pick<BookingCallInput, "requestUrl" | "clinic" | "runtimeMenu">,
): string {
  return buildEffectiveClinicMainMenuXml({
    message,
    inputActionUrl: buildPlivoInputActionUrl(input.requestUrl),
    clinicName: input.clinic.clinicName,
    runtimeMenu: input.runtimeMenu,
  });
}

function patientConfirmation(input: BookingCallInput, invalid = false): string {
  return buildPatientConfirmationXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_BOOKING_IDENTITY_WEBHOOK_PATH,
    ),
    invalidSelection: invalid,
  });
}

async function createCallbackForResolution(
  input: BookingCallInput,
  reason?: TelephonyBookingRequestReason,
): Promise<string> {
  const callUuid = normalizePlivoCallUuid(input.callUuid);
  if (!callUuid) {
    return messageThenMainMenu(
      "We could not safely save a callback request. Please contact the clinic directly.",
      input,
    );
  }
  const resolution = await resolveTelephonePatient({
    clinic: input.clinic,
    from: input.from,
  });
  await createTelephonyBookingRequest({
    clinic: input.clinic,
    callUuid,
    callerNumber: resolution.callerNumber,
    reason:
      reason ??
      (resolution.kind === "one"
        ? TelephonyBookingRequestReason.USER_REQUESTED
        : callbackReasonForResolution(resolution)),
  });
  return messageThenMainMenu(
    "Your callback request has been saved. The clinic can follow up using the caller number received with this call.",
    input,
  );
}

async function requireOnePatient(
  input: BookingCallInput,
): Promise<TelephonePatient | string> {
  const callUuid = normalizePlivoCallUuid(input.callUuid);
  if (!callUuid) {
    return messageThenMainMenu(
      "Telephone booking cannot continue because the call identifier is unavailable.",
      input,
    );
  }
  const resolution = await resolveTelephonePatient({
    clinic: input.clinic,
    from: input.from,
  });
  if (resolution.kind !== "one") {
    return createCallbackForResolution(input);
  }
  return resolution.patient;
}

export async function beginTelephoneBooking(input: BookingCallInput): Promise<string> {
  const patient = await requireOnePatient(input);
  return typeof patient === "string" ? patient : patientConfirmation(input);
}

function listIndex(digits: string | undefined): number | null {
  return digits && /^[1-7]$/.test(digits) ? Number(digits) - 1 : null;
}

function slotIndex(digits: string | undefined): number | null {
  return digits && /^[1-6]$/.test(digits) ? Number(digits) - 1 : null;
}

async function renderDoctorMenu(
  input: BookingCallInput,
  page = 0,
  invalidSelection = false,
): Promise<string> {
  const doctors = await listAppointmentDoctorsForClinic(input.clinic);
  if (doctors.length === 0) {
    return messageThenMainMenu(
      "No doctors are currently available for telephone booking.",
      input,
    );
  }
  const current = paginateIvrItems(doctors, page, IVR_LIST_PAGE_SIZE);
  return buildDoctorSelectionXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_BOOKING_DOCTOR_WEBHOOK_PATH,
      { page: current.page },
    ),
    doctors: current.items,
    hasNext: current.hasNext,
    invalidSelection,
  });
}

export async function handleBookingIdentityInput(input: BookingCallInput): Promise<string> {
  if (input.digits === "9") return mainMenu(input);
  if (input.digits === "2") {
    return createCallbackForResolution(
      input,
      TelephonyBookingRequestReason.USER_REQUESTED,
    );
  }
  if (input.digits !== "1") return patientConfirmation(input, true);
  const patient = await requireOnePatient(input);
  return typeof patient === "string" ? patient : renderDoctorMenu(input);
}

export async function handleBookingDoctorInput(input: BookingCallInput): Promise<string> {
  if (input.digits === "9") return mainMenu(input);
  const patient = await requireOnePatient(input);
  if (typeof patient === "string") return patient;

  const doctors = await listAppointmentDoctorsForClinic(input.clinic);
  const page = parseSignedPageState(input.requestUrl, "page");
  const current = paginateIvrItems(doctors, page, IVR_LIST_PAGE_SIZE);
  if (input.digits === "8" && current.hasNext) {
    return renderDoctorMenu(input, current.page + 1);
  }
  const index = listIndex(input.digits);
  const doctor = index === null ? undefined : current.items[index];
  if (!doctor) return renderDoctorMenu(input, current.page, true);

  const types = await listAppointmentTypesForClinic(input.clinic);
  if (types.length === 0) {
    return messageThenMainMenu(
      "No appointment types are currently available for telephone booking.",
      input,
    );
  }
  const first = paginateIvrItems(types, 0, IVR_LIST_PAGE_SIZE);
  return buildAppointmentTypeSelectionXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_BOOKING_TYPE_WEBHOOK_PATH,
      { doctorId: doctor.id, page: 0 },
    ),
    appointmentTypes: first.items,
    hasNext: first.hasNext,
  });
}

export async function handleBookingTypeInput(input: BookingCallInput): Promise<string> {
  if (input.digits === "9") return mainMenu(input);
  const patient = await requireOnePatient(input);
  if (typeof patient === "string") return patient;
  const doctorId = parseSignedIdState(input.requestUrl, "doctorId");
  if (!doctorId) return messageThenMainMenu("That selection is no longer available.", input);
  const doctor = await getAppointmentDoctorForScope({ ...input.clinic, doctorId });
  if (!doctor) return messageThenMainMenu("That doctor is no longer available.", input);

  const types = await listAppointmentTypesForClinic(input.clinic);
  const page = parseSignedPageState(input.requestUrl, "page");
  const current = paginateIvrItems(types, page, IVR_LIST_PAGE_SIZE);
  if (input.digits === "8" && current.hasNext) {
    const next = paginateIvrItems(types, current.page + 1, IVR_LIST_PAGE_SIZE);
    return buildAppointmentTypeSelectionXml({
      actionUrl: buildPlivoActionUrl(
        input.requestUrl,
        PLIVO_BOOKING_TYPE_WEBHOOK_PATH,
        { doctorId, page: next.page },
      ),
      appointmentTypes: next.items,
      hasNext: next.hasNext,
    });
  }
  const index = listIndex(input.digits);
  const type = index === null ? undefined : current.items[index];
  if (!type) {
    return buildAppointmentTypeSelectionXml({
      actionUrl: buildPlivoActionUrl(
        input.requestUrl,
        PLIVO_BOOKING_TYPE_WEBHOOK_PATH,
        { doctorId, page: current.page },
      ),
      appointmentTypes: current.items,
      hasNext: current.hasNext,
      invalidSelection: true,
    });
  }
  return renderBookingSlots(input, doctorId, type.id, 0);
}

async function loadTomorrowSlots(
  input: BookingCallInput,
  doctorId: string,
  appointmentTypeId: string,
): Promise<AppointmentSlotsResult> {
  return getAppointmentSlotsForScope({
    ...input.clinic,
    doctorId,
    appointmentTypeId,
    date: tomorrowDateOnlyInTimeZone(input.now ?? new Date(), input.clinic.timezone),
  });
}

async function renderBookingSlots(
  input: BookingCallInput,
  doctorId: string,
  appointmentTypeId: string,
  offset: number,
  invalidSelection = false,
  leadingMessage?: string,
): Promise<string> {
  let result: AppointmentSlotsResult;
  try {
    result = await loadTomorrowSlots(input, doctorId, appointmentTypeId);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      return messageThenMainMenu("That scheduling selection is no longer available.", input);
    }
    throw error;
  }
  const available = result.slots.filter((slot) => slot.status === "available");
  if (result.outcome !== "ok" || available.length === 0) {
    return messageThenMainMenu(
      "No appointment slots are currently available tomorrow for that selection.",
      input,
    );
  }
  const safeOffset =
    Number.isSafeInteger(offset) && offset >= 0 && offset < available.length
      ? offset
      : 0;
  const page = available.slice(safeOffset, safeOffset + IVR_SLOT_PAGE_SIZE);
  return buildBookingSlotSelectionXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_BOOKING_SLOTS_WEBHOOK_PATH,
      { doctorId, appointmentTypeId, offset: safeOffset },
    ),
    doctorName: result.doctorName,
    appointmentTypeName: result.appointmentTypeName,
    slotTimes: page.map((slot) => slot.start),
    hasNext: safeOffset + IVR_SLOT_PAGE_SIZE < available.length,
    invalidSelection,
    leadingMessage,
  });
}

export async function handleBookingSlotInput(input: BookingCallInput): Promise<string> {
  if (input.digits === "9") return mainMenu(input);
  const patient = await requireOnePatient(input);
  if (typeof patient === "string") return patient;
  const doctorId = parseSignedIdState(input.requestUrl, "doctorId");
  const appointmentTypeId = parseSignedIdState(input.requestUrl, "appointmentTypeId");
  if (!doctorId || !appointmentTypeId) {
    return messageThenMainMenu("That scheduling selection is no longer available.", input);
  }
  let result: AppointmentSlotsResult;
  try {
    result = await loadTomorrowSlots(input, doctorId, appointmentTypeId);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      return messageThenMainMenu("That scheduling selection is no longer available.", input);
    }
    throw error;
  }
  const available = result.slots.filter((slot) => slot.status === "available");
  const offset = parseSignedPageState(input.requestUrl, "offset");
  const safeOffset = offset < available.length ? offset : 0;
  if (input.digits === "8" && safeOffset + IVR_SLOT_PAGE_SIZE < available.length) {
    return renderBookingSlots(input, doctorId, appointmentTypeId, safeOffset + IVR_SLOT_PAGE_SIZE);
  }
  const index = slotIndex(input.digits);
  const selected = index === null ? undefined : available[safeOffset + index];
  if (!selected || index === null || index >= IVR_SLOT_PAGE_SIZE) {
    return renderBookingSlots(input, doctorId, appointmentTypeId, safeOffset, true);
  }
  return buildFinalBookingConfirmationXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_BOOKING_CONFIRM_WEBHOOK_PATH,
      { doctorId, appointmentTypeId, startTime: selected.start },
    ),
    doctorName: result.doctorName,
    appointmentTypeName: result.appointmentTypeName,
    startTime: selected.start,
  });
}

export async function handleBookingConfirmationInput(input: BookingCallInput): Promise<string> {
  if (input.digits === "9") return mainMenu(input);
  if (input.digits === "3") {
    return createCallbackForResolution(input, TelephonyBookingRequestReason.USER_REQUESTED);
  }
  const callUuid = normalizePlivoCallUuid(input.callUuid);
  if (!callUuid) {
    return messageThenMainMenu("Telephone booking cannot continue because the call identifier is unavailable.", input);
  }
  const existing = await getPhoneIvrAppointmentForCall({
    tenantId: input.clinic.tenantId,
    clinicId: input.clinic.clinicId,
    callUuid,
  });
  if (existing) {
    return messageThenMainMenu("Your appointment is confirmed for tomorrow.", input);
  }

  const patient = await requireOnePatient(input);
  if (typeof patient === "string") return patient;
  const doctorId = parseSignedIdState(input.requestUrl, "doctorId");
  const appointmentTypeId = parseSignedIdState(input.requestUrl, "appointmentTypeId");
  const startTime = parseSignedIdState(input.requestUrl, "startTime");
  if (!doctorId || !appointmentTypeId || !startTime) {
    return messageThenMainMenu("That scheduling selection is no longer available.", input);
  }
  if (input.digits === "2") {
    return renderBookingSlots(input, doctorId, appointmentTypeId, 0);
  }
  let result: AppointmentSlotsResult;
  try {
    result = await loadTomorrowSlots(input, doctorId, appointmentTypeId);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      return messageThenMainMenu("That scheduling selection is no longer available.", input);
    }
    throw error;
  }
  const selected = result.slots.find(
    (slot) => slot.status === "available" && slot.start === startTime,
  );
  if (!selected) {
    return renderBookingSlots(
      input,
      doctorId,
      appointmentTypeId,
      0,
      false,
      "That appointment time is no longer available.",
    );
  }
  if (input.digits !== "1") {
    return buildFinalBookingConfirmationXml({
      actionUrl: buildPlivoActionUrl(input.requestUrl, PLIVO_BOOKING_CONFIRM_WEBHOOK_PATH, {
        doctorId,
        appointmentTypeId,
        startTime,
      }),
      doctorName: result.doctorName,
      appointmentTypeName: result.appointmentTypeName,
      startTime,
      invalidSelection: true,
    });
  }

  const date = tomorrowDateOnlyInTimeZone(input.now ?? new Date(), input.clinic.timezone);
  try {
    await createAppointmentForScope({
      tenantId: input.clinic.tenantId,
      clinicId: input.clinic.clinicId,
      doctorId,
      appointmentTypeId,
      patientId: patient.id,
      patientSnapshot: patient,
      slotStart: parseDateTime(date, selected.start).toISOString(),
      slotEnd: parseDateTime(date, selected.end).toISOString(),
      provenance: {
        bookingSource: "PHONE_IVR",
        bookingSourceRef: buildPhoneBookingSourceRef(input.clinic.clinicId, callUuid),
        bookedById: null,
        auditActorUserId: null,
      },
    });
    return messageThenMainMenu(
      `Your appointment is booked with ${result.doctorName} tomorrow at ${formatClockTimeForSpeech(startTime)}.`,
      input,
    );
  } catch (error: unknown) {
    if (
      error instanceof ConflictError ||
      error instanceof BadRequestError ||
      error instanceof ScopeError
    ) {
      return renderBookingSlots(
        input,
        doctorId,
        appointmentTypeId,
        0,
        false,
        "That appointment time is no longer available.",
      );
    }
    throw error;
  }
}
