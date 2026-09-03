import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { ScopeError, type ActorContext } from "@/lib/rbac";
import { RateLimitError } from "@/lib/rateLimit";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import { getClinicPhoneSettingsForActor } from "@/lib/telephony/clinicPhoneSettings";
import { normalizeConfiguredPhoneNumber } from "@/lib/telephony/phoneNumber";
import {
  createTelephonyTestCallProvider,
  TELEPHONY_TEST_CALL_RING_LIMIT_SECONDS,
  TELEPHONY_TEST_CALL_TIME_LIMIT_SECONDS,
  type TelephonyTestCallProvider,
} from "@/lib/telephony/plivoClient";
import {
  buildTelephonyTestCallCallbackUrl,
  PLIVO_TEST_CALL_ANSWER_WEBHOOK_PATH,
  PLIVO_TEST_CALL_STATUS_WEBHOOK_PATH,
} from "@/lib/telephony/testCallIvr";
import {
  isActiveTelephonyTestCallStatus,
  telephonyTestCallMessage,
  type TelephonyTestCallPanelView,
  type TelephonyTestCallStatus,
  type TelephonyTestCallView,
} from "@/lib/telephony/testCallContract";
import {
  resolveTelephonyTestCallEnvironment,
  resolveTelephonyTestDestinationLabel,
  type TelephonyTestCallEnvironmentSource,
} from "@/lib/telephony/testCallEnvironment";

export const TELEPHONY_TEST_CALL_COOLDOWN_MS = 2 * 60 * 1000;
export const TELEPHONY_TEST_CALL_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TELEPHONY_TEST_CALL_DAILY_LIMIT = 5;
export const TELEPHONY_TEST_CALL_ACTIVE_TTL_MS = 5 * 60 * 1000;

const TEST_CALL_RATE_LIMIT_MESSAGE =
  "Too many test calls. Wait before trying again.";
const TEST_CALL_ENVIRONMENT_MESSAGE =
  "Test calling is not available in this environment.";

interface StoredTestCallView {
  id: string;
  status: TelephonyTestCallStatus;
  destinationLast4: string | null;
  createdAt: Date;
  answeredAt: Date | null;
  completedAt: Date | null;
}

interface CallbackTestCallRow extends StoredTestCallView {
  clinicId: string;
  providerRequestUuid: string | null;
  providerCallUuid: string | null;
  activeClinicId: string | null;
  expiresAt: Date;
  clinic: { name: string; tenantId: string };
}

export type TelephonyTestCallTransition =
  | { readonly kind: "ringing" }
  | { readonly kind: "answered" }
  | { readonly kind: "completed" }
  | {
      readonly kind: "failed";
      readonly failureCategory:
        | "NO_ANSWER"
        | "BUSY"
        | "PROVIDER_ERROR"
        | "UNKNOWN";
    }
  | { readonly kind: "none" };

export interface TrustedTelephonyTestCallContext {
  readonly testCallId: string;
  readonly clinicId: string;
  readonly clinicName: string;
  readonly tenantId: string;
  readonly status: TelephonyTestCallStatus;
  readonly terminal: boolean;
}

export class TelephonyTestCallProviderError extends Error {
  constructor() {
    super("The test call could not be started. Try again later.");
    this.name = "TelephonyTestCallProviderError";
  }
}

export class TelephonyTestCallCallbackError extends Error {
  readonly responseStatus: 403 | 404;

  constructor(responseStatus: 403 | 404) {
    super(responseStatus === 403 ? "Forbidden." : "Not found.");
    this.name = "TelephonyTestCallCallbackError";
    this.responseStatus = responseStatus;
  }
}

function toSafeView(row: StoredTestCallView): TelephonyTestCallView {
  return Object.freeze({
    id: row.id,
    status: row.status,
    destinationLabel:
      row.destinationLast4 === null
        ? "Configured QA number"
        : `Test number ending in ${row.destinationLast4}`,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    message: telephonyTestCallMessage(row.status),
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function normalizeProviderIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized !== "" && normalized.length <= 128 ? normalized : null;
}

async function expireActiveAttempt(
  client: Pick<typeof prisma, "clinicTelephonyTestCall">,
  clinicId: string,
  now: Date,
): Promise<void> {
  await client.clinicTelephonyTestCall.updateMany({
    where: { activeClinicId: clinicId, expiresAt: { lte: now } },
    data: {
      status: "FAILED",
      failureCategory: "UNKNOWN",
      activeClinicId: null,
      completedAt: now,
    },
  });
}

async function rateState(
  client: Pick<typeof prisma, "clinicTelephonyTestCall">,
  actor: ActorContext,
  clinicId: string,
  now: Date,
) {
  const dayStart = new Date(now.getTime() - TELEPHONY_TEST_CALL_DAILY_WINDOW_MS);
  const [active, latest, clinicDailyCount, userDailyCount] = await Promise.all([
    client.clinicTelephonyTestCall.findFirst({
      where: { activeClinicId: clinicId },
      orderBy: { createdAt: "desc" },
    }),
    client.clinicTelephonyTestCall.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
    }),
    client.clinicTelephonyTestCall.count({
      where: { clinicId, createdAt: { gte: dayStart } },
    }),
    client.clinicTelephonyTestCall.count({
      where: {
        clinicId,
        requestedByUserId: actor.userId,
        createdAt: { gte: dayStart },
      },
    }),
  ]);
  return { active, latest, clinicDailyCount, userDailyCount };
}

function rateUnavailableReason(
  state: Awaited<ReturnType<typeof rateState>>,
  now: Date,
): string | null {
  if (state.active) return "A test call is already in progress for this clinic.";
  if (
    state.latest &&
    state.latest.createdAt.getTime() + TELEPHONY_TEST_CALL_COOLDOWN_MS >
      now.getTime()
  ) {
    return "Wait two minutes between test calls.";
  }
  if (
    state.clinicDailyCount >= TELEPHONY_TEST_CALL_DAILY_LIMIT ||
    state.userDailyCount >= TELEPHONY_TEST_CALL_DAILY_LIMIT
  ) {
    return "The daily test-call limit has been reached.";
  }
  return null;
}

async function assertTestCallMeaningful(
  actor: ActorContext,
  clinicId: string,
): Promise<Awaited<ReturnType<typeof getClinicPhoneSettingsForActor>>> {
  const settings = await getClinicPhoneSettingsForActor(actor, clinicId);
  if (
    settings.serviceStatus !== "active" ||
    settings.readiness.phoneService.status !== "ready" ||
    settings.readiness.phoneMenu.status !== "ready"
  ) {
    throw new BadRequestError(
      "Phone service must be active before its menu can be tested.",
    );
  }
  return settings;
}

function testCallMeaningfulUnavailableReason(settings: Awaited<
  ReturnType<typeof getClinicPhoneSettingsForActor>
>): string | null {
  return settings.serviceStatus !== "active" ||
    settings.readiness.phoneService.status !== "ready" ||
    settings.readiness.phoneMenu.status !== "ready"
    ? "Phone service must be active before its menu can be tested."
    : null;
}

export async function getTelephonyTestCallPanelForActor(
  actor: ActorContext,
  clinicId: string,
  options: { now?: Date; environment?: TelephonyTestCallEnvironmentSource } = {},
): Promise<TelephonyTestCallPanelView> {
  const now = options.now ?? new Date();
  const settings = await getClinicPhoneSettingsForActor(actor, clinicId);
  const config = await prisma.clinicTelephonyConfig.findUnique({
    where: { clinicId },
    select: { plivoNumber: true },
  });
  await expireActiveAttempt(prisma, clinicId, now);
  const state = await rateState(prisma, actor, clinicId, now);
  const environment = resolveTelephonyTestCallEnvironment(options.environment);
  const destinationLabel = resolveTelephonyTestDestinationLabel(
    options.environment,
  );
  const unavailableReason =
    testCallMeaningfulUnavailableReason(settings) ??
    (environment === null ||
    environment.destination === config?.plivoNumber ||
    environment.destination === settings.publicPhoneNumber
      ? TEST_CALL_ENVIRONMENT_MESSAGE
      : rateUnavailableReason(state, now));
  return Object.freeze({
    available: unavailableReason === null,
    destinationLabel,
    unavailableReason,
    latestAttempt: state.latest ? toSafeView(state.latest) : null,
  });
}

export async function startTelephonyTestCallForActor(
  actor: ActorContext,
  clinicId: string,
  requestUrl: string,
  options: {
    now?: Date;
    environment?: TelephonyTestCallEnvironmentSource;
    provider?: TelephonyTestCallProvider;
  } = {},
): Promise<TelephonyTestCallView> {
  const now = options.now ?? new Date();
  await assertActorCanManageTelephony(actor, clinicId);
  const settings = await assertTestCallMeaningful(actor, clinicId);
  const environment = resolveTelephonyTestCallEnvironment(options.environment);
  if (environment === null) {
    throw new BadRequestError(TEST_CALL_ENVIRONMENT_MESSAGE);
  }
  const config = await prisma.clinicTelephonyConfig.findUnique({
    where: { clinicId },
    select: { enabled: true, plivoNumber: true },
  });
  let providerNumber: string;
  try {
    providerNumber = normalizeConfiguredPhoneNumber(config?.plivoNumber ?? "");
  } catch {
    throw new BadRequestError(
      "Phone service must be active before its menu can be tested.",
    );
  }
  if (config?.enabled !== true) {
    throw new BadRequestError(
      "Phone service must be active before its menu can be tested.",
    );
  }
  if (
    environment.destination === providerNumber ||
    environment.destination === settings.publicPhoneNumber
  ) {
    throw new BadRequestError(TEST_CALL_ENVIRONMENT_MESSAGE);
  }

  let attempt: StoredTestCallView;
  try {
    attempt = await prisma.$transaction(async (tx) => {
      await expireActiveAttempt(tx, clinicId, now);
      const state = await rateState(tx, actor, clinicId, now);
      const unavailableReason = rateUnavailableReason(state, now);
      if (state.active) throw new ConflictError(unavailableReason!);
      if (unavailableReason) {
        throw new RateLimitError(
          TEST_CALL_RATE_LIMIT_MESSAGE,
          TELEPHONY_TEST_CALL_COOLDOWN_MS,
        );
      }

      const created = await tx.clinicTelephonyTestCall.create({
        data: {
          clinicId,
          requestedByUserId: actor.userId,
          destinationLast4: environment.destinationLast4,
          activeClinicId: clinicId,
          expiresAt: new Date(now.getTime() + TELEPHONY_TEST_CALL_ACTIVE_TTL_MS),
        },
      });
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CLINIC_TELEPHONY_TEST_CALL_STARTED,
        targetType: "ClinicTelephonyTestCall",
        targetId: created.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { clinicId },
      });
      return created;
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(
        "A test call is already in progress for this clinic.",
      );
    }
    throw error;
  }

  const answerUrl = buildTelephonyTestCallCallbackUrl({
    requestUrl,
    path: PLIVO_TEST_CALL_ANSWER_WEBHOOK_PATH,
    testCallId: attempt.id,
  });
  const statusUrl = buildTelephonyTestCallCallbackUrl({
    requestUrl,
    path: PLIVO_TEST_CALL_STATUS_WEBHOOK_PATH,
    testCallId: attempt.id,
  });
  const provider =
    options.provider ??
    createTelephonyTestCallProvider({
      authId: environment.authId,
      authToken: environment.authToken,
    });

  let providerResult: { readonly requestUuid: string };
  try {
    providerResult = await provider.createTestCall({
      from: providerNumber,
      to: environment.destination,
      answerUrl,
      ringUrl: statusUrl,
      hangupUrl: statusUrl,
      timeLimitSeconds: TELEPHONY_TEST_CALL_TIME_LIMIT_SECONDS,
      ringLimitSeconds: TELEPHONY_TEST_CALL_RING_LIMIT_SECONDS,
    });
  } catch (error: unknown) {
    await prisma.clinicTelephonyTestCall.updateMany({
      where: { id: attempt.id, activeClinicId: clinicId },
      data: {
        status: "FAILED",
        failureCategory: "PROVIDER_ERROR",
        activeClinicId: null,
        completedAt: new Date(),
      },
    });
    console.error("Plivo test call provider request failed.", {
      clinicId,
      testCallId: attempt.id,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TelephonyTestCallProviderError();
  }

  const updated = await prisma.clinicTelephonyTestCall.update({
    where: { id: attempt.id },
    data: { providerRequestUuid: providerResult.requestUuid },
  });
  return toSafeView(updated);
}

export async function getTelephonyTestCallForActor(
  actor: ActorContext,
  clinicId: string,
  testCallId: string,
  now = new Date(),
): Promise<TelephonyTestCallView> {
  await assertActorCanManageTelephony(actor, clinicId);
  await expireActiveAttempt(prisma, clinicId, now);
  const attempt = await prisma.clinicTelephonyTestCall.findFirst({
    where: { id: testCallId, clinicId },
  });
  if (!attempt) throw new ScopeError();
  return toSafeView(attempt);
}

function callbackContext(row: CallbackTestCallRow): TrustedTelephonyTestCallContext {
  return Object.freeze({
    testCallId: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinic.name,
    tenantId: row.clinic.tenantId,
    status: row.status,
    terminal: !isActiveTelephonyTestCallStatus(row.status),
  });
}

export async function bindAndTransitionTelephonyTestCallCallback(input: {
  testCallId: string;
  callUuid: unknown;
  requestUuid?: unknown;
  transition: TelephonyTestCallTransition;
  now?: Date;
}): Promise<TrustedTelephonyTestCallContext> {
  const now = input.now ?? new Date();
  const callUuid = normalizeProviderIdentifier(input.callUuid);
  const requestUuid = normalizeProviderIdentifier(input.requestUuid);
  if (input.testCallId.trim() === "" || callUuid === null) {
    throw new TelephonyTestCallCallbackError(404);
  }

  return prisma.$transaction(async (tx) => {
    let row = (await tx.clinicTelephonyTestCall.findUnique({
      where: { id: input.testCallId },
      include: { clinic: { select: { name: true, tenantId: true } } },
    })) as CallbackTestCallRow | null;
    if (!row) throw new TelephonyTestCallCallbackError(404);

    if (
      row.providerRequestUuid !== null &&
      requestUuid !== null &&
      row.providerRequestUuid !== requestUuid
    ) {
      throw new TelephonyTestCallCallbackError(403);
    }
    if (row.providerCallUuid !== null && row.providerCallUuid !== callUuid) {
      throw new TelephonyTestCallCallbackError(403);
    }
    if (!isActiveTelephonyTestCallStatus(row.status)) {
      return callbackContext(row);
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      await tx.clinicTelephonyTestCall.updateMany({
        where: { id: row.id, activeClinicId: row.clinicId },
        data: {
          status: "FAILED",
          failureCategory: "UNKNOWN",
          activeClinicId: null,
          completedAt: now,
        },
      });
      throw new TelephonyTestCallCallbackError(404);
    }

    if (row.providerCallUuid === null) {
      await tx.clinicTelephonyTestCall.updateMany({
        where: {
          id: row.id,
          providerCallUuid: null,
          activeClinicId: row.clinicId,
        },
        data: { providerCallUuid: callUuid },
      });
      row = (await tx.clinicTelephonyTestCall.findUnique({
        where: { id: row.id },
        include: { clinic: { select: { name: true, tenantId: true } } },
      })) as CallbackTestCallRow;
      if (row.providerCallUuid !== callUuid) {
        throw new TelephonyTestCallCallbackError(403);
      }
    }

    if (input.transition.kind === "ringing") {
      await tx.clinicTelephonyTestCall.updateMany({
        where: {
          id: row.id,
          activeClinicId: row.clinicId,
          status: "REQUESTED",
        },
        data: { status: "RINGING" },
      });
    } else if (input.transition.kind === "answered") {
      await tx.clinicTelephonyTestCall.updateMany({
        where: {
          id: row.id,
          activeClinicId: row.clinicId,
          status: { in: ["REQUESTED", "RINGING"] },
        },
        data: { status: "ANSWERED", answeredAt: now },
      });
    } else if (input.transition.kind === "completed") {
      await tx.clinicTelephonyTestCall.updateMany({
        where: {
          id: row.id,
          activeClinicId: row.clinicId,
          status: { in: ["REQUESTED", "RINGING", "ANSWERED"] },
        },
        data: { status: "COMPLETED", activeClinicId: null, completedAt: now },
      });
    } else if (input.transition.kind === "failed") {
      await tx.clinicTelephonyTestCall.updateMany({
        where: {
          id: row.id,
          activeClinicId: row.clinicId,
          status: { in: ["REQUESTED", "RINGING", "ANSWERED"] },
        },
        data: {
          status: "FAILED",
          failureCategory: input.transition.failureCategory,
          activeClinicId: null,
          completedAt: now,
        },
      });
    }
    if (input.transition.kind !== "none") {
      row = (await tx.clinicTelephonyTestCall.findUnique({
        where: { id: row.id },
        include: { clinic: { select: { name: true, tenantId: true } } },
      })) as CallbackTestCallRow;
    }
    return callbackContext(row);
  });
}

export function resolveTelephonyTestCallStatusTransition(
  params: Readonly<Record<string, string | readonly string[]>>,
): TelephonyTestCallTransition {
  const one = (value: string | readonly string[] | undefined) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const callStatus = one(params.CallStatus);
  if (callStatus === "completed") return { kind: "completed" };
  if (callStatus === "busy") {
    return { kind: "failed", failureCategory: "BUSY" };
  }
  if (callStatus === "no-answer" || callStatus === "timeout") {
    return { kind: "failed", failureCategory: "NO_ANSWER" };
  }
  if (callStatus === "failed") {
    return { kind: "failed", failureCategory: "PROVIDER_ERROR" };
  }
  if (callStatus === "cancel" || callStatus === "cancelled") {
    return { kind: "failed", failureCategory: "UNKNOWN" };
  }
  if (callStatus === "in-progress") return { kind: "answered" };
  if (callStatus === "ringing" || one(params.Event) === "ring") {
    return { kind: "ringing" };
  }
  return { kind: "none" };
}
