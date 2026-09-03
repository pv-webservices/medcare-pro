import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getHours: vi.fn(),
  updateHours: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, requireModule: mocks.requireModule };
});

vi.mock("@/lib/telephony/businessHours", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/telephony/businessHours")>();
  return {
    ...actual,
    getClinicBusinessHoursForActor: mocks.getHours,
    updateClinicBusinessHoursForActor: mocks.updateHours,
  };
});

import {
  GET,
  PUT,
} from "@/app/api/clinics/[id]/telephony/hours/route";
import { CLINIC_BUSINESS_WEEKDAYS } from "@/lib/telephony/businessHours";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };
const context = { params: Promise.resolve({ id: "clinic-a" }) };
const validHours = CLINIC_BUSINESS_WEEKDAYS.map((dayOfWeek) => ({
  dayOfWeek,
  isClosed: true,
}));

function put(body: unknown) {
  return PUT(
    new Request("https://app.example/api/clinics/clinic-a/telephony/hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  );
}

describe("clinic business-hours API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireActor.mockResolvedValue(ACTOR);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.getHours.mockResolvedValue({ clinicId: "clinic-a", hours: [] });
    mocks.updateHours.mockImplementation(async (_actor, clinicId, input) => ({
      clinicId,
      hours: input.hours,
    }));
  });

  it("authenticates, gates the ivr module, and scopes GET by route id", async () => {
    const response = await GET(new Request("https://app.example"), context);
    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(ACTOR, "ivr");
    expect(mocks.getHours).toHaveBeenCalledWith(ACTOR, "clinic-a");
  });

  it("accepts an exact full-week PUT and canonicalizes closed times", async () => {
    const response = await put({
      hours: validHours.map((day) => ({
        ...day,
        openTime: "09:00",
        closeTime: "17:00",
      })),
    });
    expect(response.status).toBe(200);
    const parsed = mocks.updateHours.mock.calls[0][2];
    expect(parsed.hours).toHaveLength(7);
    expect(parsed.hours[0]).toMatchObject({ openTime: null, closeTime: null });
  });

  it.each([
    ["tenantId", { hours: validHours, tenantId: "tenant-b" }],
    ["clinicId", { hours: validHours, clinicId: "clinic-b" }],
    ["partial week", { hours: validHours.slice(0, 6) }],
    [
      "unknown weekday",
      {
        hours: validHours.map((day, index) =>
          index === 0 ? { ...day, dayOfWeek: "HOLIDAY" } : day,
        ),
      },
    ],
  ])("rejects %s without calling the write service", async (_case, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(mocks.updateHours).not.toHaveBeenCalled();
  });
});
