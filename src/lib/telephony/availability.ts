import {
  getAppointmentDoctorForScope,
  getAppointmentSlotsForScope,
  listAppointmentDoctorsForClinic,
  listAppointmentTypesForClinic,
  type AppointmentSlotsResult,
} from "@/lib/appointmentAvailability";
import { tomorrowDateOnlyInTimeZone } from "@/lib/dates";
import { ScopeError } from "@/lib/rbac";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  IVR_LIST_PAGE_SIZE,
  IVR_SLOT_PAGE_SIZE,
  paginateIvrItems,
} from "@/lib/telephony/ivr";
import {
  buildAppointmentTypeSelectionXml,
  buildDoctorSelectionXml,
  buildEffectiveClinicMainMenuXml,
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
  buildSlotSelectionXml,
  PLIVO_DOCTOR_WEBHOOK_PATH,
  PLIVO_SLOTS_WEBHOOK_PATH,
  PLIVO_TYPE_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";
import type { ClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

const MAX_QUERY_INDEX = 10_000;
const MAX_STATE_ID_LENGTH = 191;

export function parseSignedPageState(requestUrl: string, key: string): number {
  const raw = new URL(requestUrl).searchParams.get(key);
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= MAX_QUERY_INDEX ? parsed : 0;
}

export function parseSignedIdState(
  requestUrl: string,
  key: string,
): string | null {
  const value = new URL(requestUrl).searchParams.get(key)?.trim() ?? "";
  return value !== "" && value.length <= MAX_STATE_ID_LENGTH ? value : null;
}

function selectedIndex(digits: string | undefined): number | null {
  return digits && /^[1-7]$/.test(digits) ? Number(digits) - 1 : null;
}

function mainMenu(
  requestUrl: string,
  clinic: InboundClinicContext,
  runtimeMenu?: ClinicIvrRuntimeMenu,
): string {
  return buildEffectiveClinicMainMenuXml({
    inputActionUrl: buildPlivoInputActionUrl(requestUrl),
    clinicName: clinic.clinicName,
    runtimeMenu,
  });
}

function messageThenMainMenu(
  message: string,
  requestUrl: string,
  clinic: InboundClinicContext,
  runtimeMenu?: ClinicIvrRuntimeMenu,
): string {
  return buildEffectiveClinicMainMenuXml({
    message,
    inputActionUrl: buildPlivoInputActionUrl(requestUrl),
    clinicName: clinic.clinicName,
    runtimeMenu,
  });
}

export async function buildDoctorMenuForClinic(
  requestUrl: string,
  clinic: InboundClinicContext,
  page = 0,
  invalidSelection = false,
  runtimeMenu?: ClinicIvrRuntimeMenu,
): Promise<string> {
  const doctors = await listAppointmentDoctorsForClinic(clinic);
  if (doctors.length === 0) {
    return messageThenMainMenu(
      "No doctors are currently available for telephone appointment lookup.",
      requestUrl,
      clinic,
      runtimeMenu,
    );
  }
  const current = paginateIvrItems(doctors, page, IVR_LIST_PAGE_SIZE);
  return buildDoctorSelectionXml({
    actionUrl: buildPlivoActionUrl(
      requestUrl,
      PLIVO_DOCTOR_WEBHOOK_PATH,
      { page: current.page },
    ),
    doctors: current.items,
    hasNext: current.hasNext,
    invalidSelection,
  });
}

export async function handleDoctorMenuInput(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  digits?: string;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): Promise<string> {
  const page = parseSignedPageState(input.requestUrl, "page");
  if (input.digits === "9") {
    return mainMenu(input.requestUrl, input.clinic, input.runtimeMenu);
  }

  const doctors = await listAppointmentDoctorsForClinic(input.clinic);
  if (doctors.length === 0) {
    return messageThenMainMenu(
      "No doctors are currently available for telephone appointment lookup.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const current = paginateIvrItems(doctors, page, IVR_LIST_PAGE_SIZE);
  if (input.digits === "8" && current.hasNext) {
    return buildDoctorMenuForClinic(
      input.requestUrl,
      input.clinic,
      current.page + 1,
      false,
      input.runtimeMenu,
    );
  }

  const index = selectedIndex(input.digits);
  const doctor = index === null ? undefined : current.items[index];
  if (!doctor) {
    return buildDoctorMenuForClinic(
      input.requestUrl,
      input.clinic,
      current.page,
      true,
      input.runtimeMenu,
    );
  }

  const appointmentTypes = await listAppointmentTypesForClinic(input.clinic);
  if (appointmentTypes.length === 0) {
    return messageThenMainMenu(
      "No appointment types are currently available for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const typePage = paginateIvrItems(
    appointmentTypes,
    0,
    IVR_LIST_PAGE_SIZE,
  );
  return buildAppointmentTypeSelectionXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_TYPE_WEBHOOK_PATH,
      { doctorId: doctor.id, page: 0 },
    ),
    appointmentTypes: typePage.items,
    hasNext: typePage.hasNext,
  });
}

export async function handleAppointmentTypeMenuInput(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  digits?: string;
  now?: Date;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): Promise<string> {
  if (input.digits === "9") {
    return mainMenu(input.requestUrl, input.clinic, input.runtimeMenu);
  }

  const doctorId = parseSignedIdState(input.requestUrl, "doctorId");
  if (!doctorId) {
    return messageThenMainMenu(
      "That doctor is no longer available for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const doctor = await getAppointmentDoctorForScope({
    ...input.clinic,
    doctorId,
  });
  if (!doctor) {
    return messageThenMainMenu(
      "That doctor is no longer available for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }

  const appointmentTypes = await listAppointmentTypesForClinic(input.clinic);
  if (appointmentTypes.length === 0) {
    return messageThenMainMenu(
      "No appointment types are currently available for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const page = parseSignedPageState(input.requestUrl, "page");
  const current = paginateIvrItems(
    appointmentTypes,
    page,
    IVR_LIST_PAGE_SIZE,
  );
  if (input.digits === "8" && current.hasNext) {
    const nextPage = current.page + 1;
    const next = paginateIvrItems(
      appointmentTypes,
      nextPage,
      IVR_LIST_PAGE_SIZE,
    );
    return buildAppointmentTypeSelectionXml({
      actionUrl: buildPlivoActionUrl(
        input.requestUrl,
        PLIVO_TYPE_WEBHOOK_PATH,
        { doctorId, page: next.page },
      ),
      appointmentTypes: next.items,
      hasNext: next.hasNext,
    });
  }

  const index = selectedIndex(input.digits);
  const appointmentType = index === null ? undefined : current.items[index];
  if (!appointmentType) {
    return buildAppointmentTypeSelectionXml({
      actionUrl: buildPlivoActionUrl(
        input.requestUrl,
        PLIVO_TYPE_WEBHOOK_PATH,
        { doctorId, page: current.page },
      ),
      appointmentTypes: current.items,
      hasNext: current.hasNext,
      invalidSelection: true,
    });
  }

  const tomorrow = tomorrowDateOnlyInTimeZone(
    input.now ?? new Date(),
    input.clinic.timezone,
  );
  try {
    const result = await getAppointmentSlotsForScope({
      ...input.clinic,
      doctorId,
      appointmentTypeId: appointmentType.id,
      date: tomorrow,
    });
    return renderSlotResult({
      requestUrl: input.requestUrl,
      clinic: input.clinic,
      result,
      offset: 0,
      runtimeMenu: input.runtimeMenu,
    });
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      return messageThenMainMenu(
        "That scheduling selection is no longer available for telephone scheduling.",
        input.requestUrl,
        input.clinic,
        input.runtimeMenu,
      );
    }
    throw error;
  }
}

function renderSlotResult(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  result: AppointmentSlotsResult;
  offset: number;
  invalidSelection?: boolean;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): string {
  const { result } = input;
  if (result.outcome === "invalid-date") {
    throw new Error("The clinic-local tomorrow date was rejected by the slot engine.");
  }
  if (result.outcome === "on-leave") {
    return messageThenMainMenu(
      `${result.doctorName} is unavailable tomorrow.`,
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  if (result.outcome === "no-availability") {
    return messageThenMainMenu(
      `${result.doctorName} has no availability configured for tomorrow.`,
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  if (result.outcome === "invalid-duration") {
    return messageThenMainMenu(
      "This appointment type is temporarily unavailable for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }

  const available = result.slots.filter((slot) => slot.status === "available");
  if (available.length === 0) {
    return messageThenMainMenu(
      `No appointment slots are available tomorrow for ${result.doctorName} for ${result.appointmentTypeName}.`,
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const safeOffset =
    Number.isSafeInteger(input.offset) &&
    input.offset >= 0 &&
    input.offset < available.length
      ? input.offset
      : 0;
  const page = available.slice(safeOffset, safeOffset + IVR_SLOT_PAGE_SIZE);
  const hasNext = safeOffset + IVR_SLOT_PAGE_SIZE < available.length;
  return buildSlotSelectionXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_SLOTS_WEBHOOK_PATH,
      {
        doctorId: result.doctorId,
        appointmentTypeId: result.appointmentTypeId,
        offset: safeOffset,
      },
    ),
    doctorName: result.doctorName,
    appointmentTypeName: result.appointmentTypeName,
    slotTimes: page.map((slot) => slot.start),
    hasNext,
    invalidSelection: input.invalidSelection,
  });
}

export async function handleSlotMenuInput(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  digits?: string;
  now?: Date;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): Promise<string> {
  if (input.digits === "9") {
    return mainMenu(input.requestUrl, input.clinic, input.runtimeMenu);
  }

  const doctorId = parseSignedIdState(input.requestUrl, "doctorId");
  const appointmentTypeId = parseSignedIdState(
    input.requestUrl,
    "appointmentTypeId",
  );
  if (!doctorId || !appointmentTypeId) {
    return messageThenMainMenu(
      "That scheduling selection is no longer available for telephone scheduling.",
      input.requestUrl,
      input.clinic,
      input.runtimeMenu,
    );
  }
  const tomorrow = tomorrowDateOnlyInTimeZone(
    input.now ?? new Date(),
    input.clinic.timezone,
  );
  try {
    const result = await getAppointmentSlotsForScope({
      ...input.clinic,
      doctorId,
      appointmentTypeId,
      date: tomorrow,
    });
    const availableCount = result.slots.filter(
      (slot) => slot.status === "available",
    ).length;
    const currentOffset = parseSignedPageState(input.requestUrl, "offset");
    const safeOffset =
      currentOffset < availableCount ? currentOffset : 0;
    const hasNext = safeOffset + IVR_SLOT_PAGE_SIZE < availableCount;
    const nextOffset =
      input.digits === "8" && hasNext
        ? safeOffset + IVR_SLOT_PAGE_SIZE
        : safeOffset;
    return renderSlotResult({
      requestUrl: input.requestUrl,
      clinic: input.clinic,
      result,
      offset: nextOffset,
      invalidSelection: input.digits !== "8" || !hasNext,
      runtimeMenu: input.runtimeMenu,
    });
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      return messageThenMainMenu(
        "That scheduling selection is no longer available for telephone scheduling.",
        input.requestUrl,
        input.clinic,
        input.runtimeMenu,
      );
    }
    throw error;
  }
}
