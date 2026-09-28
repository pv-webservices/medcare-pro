import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An in-memory `whatsapp_messages` table and a `$transaction` that runs one
 * callback at a time — the behaviour `SELECT ... FROM tenants FOR UPDATE`
 * gives the real claim. That lets these tests overlap two bulk sends the way a
 * retried request or a second app instance does in production.
 */
const db = vi.hoisted(() => {
  interface Row {
    id: string;
    clinicId: string;
    patientId: string;
    templateName: string;
    status: string;
    sentAt: Date;
    failureReason?: string | null;
  }
  interface Where {
    clinicId?: string;
    templateName?: string;
    status?: { in: string[] };
    sentAt?: { gte: Date; lt: Date };
  }

  const state = {
    rows: [] as Row[],
    mobiles: new Map<string, string>(),
    nextId: 1,
    lock: Promise.resolve() as Promise<unknown>,
  };

  const whatsappMessage = {
    findMany: async ({ where }: { where: Where }) =>
      state.rows
        .filter(
          (row) =>
            (!where.clinicId || row.clinicId === where.clinicId) &&
            (!where.templateName || row.templateName === where.templateName) &&
            (!where.status || where.status.in.includes(row.status)) &&
            (!where.sentAt ||
              (row.sentAt >= where.sentAt.gte && row.sentAt < where.sentAt.lt)),
        )
        .map((row) => ({
          patientId: row.patientId,
          patient: { mobileNumber: state.mobiles.get(row.patientId) ?? "" },
        })),
    create: async ({ data }: { data: Omit<Row, "id" | "sentAt"> }) => {
      const row = { ...data, id: `msg-${state.nextId++}`, sentAt: new Date() };
      state.rows.push(row);
      return { id: row.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const index = state.rows.findIndex((row) => row.id === where.id);
      state.rows[index] = { ...state.rows[index], ...data };
      return state.rows[index];
    },
  };

  const tx = { whatsappMessage, $queryRaw: async () => [] };

  const prisma = {
    patient: { findMany: vi.fn() },
    whatsappMessage,
    whatsappTemplateMedia: { findUnique: async () => null },
    mediaAsset: { update: async () => ({}) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const run = state.lock.then(() => callback(tx));
      state.lock = run.catch(() => undefined);
      return run;
    }),
  };

  return { state, prisma };
});

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

vi.mock("@/lib/whatsapp", () => ({
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  checkNumber: vi.fn(),
  readWhatsappConfig: vi.fn(),
  WhatsappNotConfiguredError: class WhatsappNotConfiguredError extends Error {},
  MEDIA_TYPES: ["image", "video", "audio", "document"],
}));

vi.mock("@/lib/whatsappProviderConfig", () => ({
  resolveWhatsappConfigForClinic: vi.fn(),
}));

vi.mock("@/lib/clinicScope", () => ({
  clinicWhereForActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rbac")>()),
  assertClinicInTenant: vi.fn().mockResolvedValue(undefined),
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/whatsappTemplates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsappTemplates")>()),
  assertCanSendSomewhere: vi.fn().mockResolvedValue(undefined),
  getTemplateForActor: vi.fn(),
}));

import { checkNumber, sendText } from "@/lib/whatsapp";
import { resolveWhatsappConfigForClinic } from "@/lib/whatsappProviderConfig";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { getTemplateForActor, type TemplateRecord } from "@/lib/whatsappTemplates";
import {
  ALREADY_SENT_TODAY_REASON,
  IN_FLIGHT_STATUS,
  SAME_NUMBER_SENT_TODAY_REASON,
  listSentTemplateToday,
  sendToPatients,
  todaySendWindow,
} from "@/lib/whatsappMessages";

const actor = { userId: "user-1", tenantId: "tenant-1" } as unknown as ActorContext;

const template: TemplateRecord = {
  id: "tmpl-1",
  name: "Follow-up reminder",
  body: "Hi {patientName}",
  footer: null,
  mediaType: null,
  mediaUrl: null,
  placeholders: ["patientName"],
};

interface FixturePatient {
  id: string;
  name: string;
  mobileNumber: string;
}

const RAMESH = { id: "p1", name: "Ramesh Kumar", mobileNumber: "9800000001" };
// The same person registered a second time, number typed differently.
const RAMESH_AGAIN = { id: "p2", name: "Ramesh K", mobileNumber: "+91 98000-00001" };
const SUNITA = { id: "p3", name: "Sunita Devi", mobileNumber: "9800000003" };
const PRIYA = { id: "p4", name: "Priya Shah", mobileNumber: "9800000004" };

function usePatients(patients: readonly FixturePatient[]): void {
  for (const patient of patients) db.state.mobiles.set(patient.id, patient.mobileNumber);
  // Returned in reverse, as a database is free to: the send must follow the
  // order the front desk picked, not this one.
  vi.mocked(db.prisma.patient.findMany).mockImplementation((async ({
    where,
  }: {
    where: { id: { in: string[] } };
  }) =>
    [...patients]
      .reverse()
      .filter((patient) => where.id.in.includes(patient.id))
      .map((patient) => ({
        ...patient,
        patientCode: `PT-2026-${patient.id}`,
        clinicId: "clinic-A",
        clinic: { name: "Alpha Clinic" },
        registrations: [],
      }))) as never);
}

function seedRow(patientId: string, status: string): void {
  db.state.rows.push({
    id: `seed-${db.state.nextId++}`,
    clinicId: "clinic-A",
    patientId,
    templateName: template.name,
    status,
    sentAt: new Date(),
  });
}

const sentNumbers = () => vi.mocked(sendText).mock.calls.map(([params]) => params.to);

beforeEach(() => {
  vi.clearAllMocks();
  db.state.rows = [];
  db.state.mobiles.clear();
  db.state.lock = Promise.resolve();
  vi.mocked(getTemplateForActor).mockResolvedValue(template);
  vi.mocked(resolveWhatsappConfigForClinic).mockResolvedValue({
    deviceId: "device-1",
    sender: "919999999999",
  } as never);
  vi.mocked(checkNumber).mockResolvedValue({ checked: true, exists: true } as never);
  // A gateway round trip takes time; that gap is where overlapping sends race.
  vi.mocked(sendText).mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, providerMessageId: null, message: "sent" };
  });
});

describe("todaySendWindow", () => {
  it("spans the Asia/Kolkata calendar day, not the UTC one", () => {
    // 20:00 UTC on 26 Sep is already 01:30 on 27 Sep in India.
    const { start, end } = todaySendWindow(new Date("2026-09-26T20:00:00.000Z"));

    expect(start.toISOString()).toBe("2026-09-26T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-27T18:30:00.000Z");
  });
});

describe("sendToPatients — one template per person per day", () => {
  it("skips a patient who already received this template today", async () => {
    usePatients([RAMESH, SUNITA]);
    seedRow(RAMESH.id, "sent");

    const result = await sendToPatients(actor, {
      templateId: template.id,
      patientIds: [RAMESH.id, SUNITA.id],
    });

    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: 1 });
    expect(result.results[0]).toMatchObject({
      patientId: RAMESH.id,
      status: "skipped",
      failureReason: ALREADY_SENT_TODAY_REASON,
    });
    expect(sentNumbers()).toEqual(["919800000003"]);
    // A skip is not an attempt, so it leaves no history row.
    expect(db.state.rows).toHaveLength(2);
  });

  it("lets a failed attempt be retried", async () => {
    usePatients([RAMESH]);
    seedRow(RAMESH.id, "failed");

    const result = await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(result.sent).toBe(1);
  });

  it("sends once per mobile number when two selected records share it", async () => {
    usePatients([RAMESH, RAMESH_AGAIN, SUNITA]);

    const result = await sendToPatients(actor, {
      templateId: template.id,
      patientIds: [RAMESH.id, RAMESH_AGAIN.id, SUNITA.id],
    });

    expect(sentNumbers()).toEqual(["919800000001", "919800000003"]);
    expect(result.results.map((row) => [row.patientId, row.status])).toEqual([
      [RAMESH.id, "sent"],
      [RAMESH_AGAIN.id, "skipped"],
      [SUNITA.id, "sent"],
    ]);
    expect(result.results[1].failureReason).toBe(SAME_NUMBER_SENT_TODAY_REASON);
  });

  it("skips a record whose number already received the template through another record", async () => {
    usePatients([RAMESH, RAMESH_AGAIN]);
    seedRow(RAMESH.id, "sent");

    const result = await sendToPatients(actor, {
      templateId: template.id,
      patientIds: [RAMESH_AGAIN.id],
    });

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("never messages anyone twice when two bulk sends of the same list overlap", async () => {
    // The production failure: the first request outlives the proxy timeout,
    // the user presses Send again, and both requests work through the list.
    usePatients([RAMESH, SUNITA, PRIYA]);
    const input = { templateId: template.id, patientIds: [RAMESH.id, SUNITA.id, PRIYA.id] };

    const [first, second] = await Promise.all([
      sendToPatients(actor, input),
      sendToPatients(actor, input),
    ]);

    expect(sentNumbers().sort()).toEqual(["919800000001", "919800000003", "919800000004"]);
    expect(first.sent + second.sent).toBe(3);
    expect(first.skipped + second.skipped).toBe(3);
  });

  it("finishes the reserved row instead of adding a second one", async () => {
    usePatients([RAMESH]);

    await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0]).toMatchObject({ patientId: RAMESH.id, status: "sent" });
  });

  it("records a gateway refusal on the reserved row, so it can be retried", async () => {
    usePatients([RAMESH]);
    vi.mocked(sendText).mockResolvedValueOnce({
      ok: false,
      providerMessageId: null,
      message: "Device not connected.",
    });

    const result = await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(result.failed).toBe(1);
    expect(db.state.rows).toEqual([
      expect.objectContaining({ status: "failed", failureReason: "Device not connected." }),
    ]);
    expect((await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] })).sent).toBe(1);
  });

  it("releases the reservation as failed when delivery breaks before the gateway call", async () => {
    usePatients([RAMESH]);
    vi.mocked(resolveWhatsappConfigForClinic).mockRejectedValueOnce(new Error("db down"));

    const result = await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(result.failed).toBe(1);
    expect(sendText).not.toHaveBeenCalled();
    expect(db.state.rows[0].status).toBe("failed");
  });

  it("fails closed without calling the gateway when the reservation cannot be made", async () => {
    usePatients([RAMESH]);
    vi.mocked(db.prisma.$transaction).mockRejectedValueOnce(new Error("lock wait timeout"));

    const result = await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("treats a send still in flight as already sent", async () => {
    usePatients([RAMESH]);
    seedRow(RAMESH.id, IN_FLIGHT_STATUS);

    const result = await sendToPatients(actor, { templateId: template.id, patientIds: [RAMESH.id] });

    expect(result.skipped).toBe(1);
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe("listSentTemplateToday", () => {
  it("requires message:send in the clinic and reports patients and numbers", async () => {
    db.state.mobiles.set(RAMESH.id, RAMESH.mobileNumber);
    seedRow(RAMESH.id, "sent");

    const sent = await listSentTemplateToday(actor, template.id, "clinic-A");

    expect(requirePermission).toHaveBeenCalledWith(actor, "message:send", "clinic-A");
    expect(sent).toEqual({ patientIds: [RAMESH.id], mobileNumbers: ["919800000001"] });
  });

  it("does not read messages when the permission check fails", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("forbidden"));

    await expect(listSentTemplateToday(actor, template.id, "clinic-B")).rejects.toThrow(
      "forbidden",
    );
  });
});
