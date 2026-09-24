import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  authorize: vi.fn(),
  accepted: vi.fn(),
  transcripts: vi.fn(),
  segments: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireActor: mocks.actor,
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/clinical-audio/authorization", () => ({ authorizeClinicalAudio: mocks.authorize }));
vi.mock("@/lib/clinical-facts/service", () => ({ getAcceptedTranscriptFacts: mocks.accepted }));
// Read-only by construction: the mock exposes no write methods at all.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicalTranscript: { findMany: mocks.transcripts },
    clinicalTranscriptSegment: { findMany: mocks.segments },
  },
}));

import { POST } from "@/app/api/clinical-ai/registrations/[registrationId]/reconciliation/route";
import { mayUseReconciliation } from "@/lib/clinical-reconciliation/service";

const actor = { userId: "doctor", tenantId: "tenant" };
const context = { params: Promise.resolve({ registrationId: "visit-1" }) };
const item = {
  medicineGenericName: "Paracetamol",
  brandName: "",
  strength: "500 mg",
  frequency: "BD",
  durationValue: 5,
  durationUnit: "days",
};
const post = (body: unknown) =>
  new Request("https://example.test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const accepted = (id: string, attributes: Record<string, string>, segmentId: string) => ({
  id,
  category: "MEDICATION_MENTION",
  assertion: "PRESENT",
  subject: "PATIENT",
  statement: "synthetic",
  attributes,
  evidence: [{ segmentId, speakerType: "DOCTOR", quote: "synthetic quote", charStart: 0, charEnd: 15 }],
  decision: "ACCEPTED",
  conflicting: false,
});

beforeEach(() => {
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-never-sent");
  vi.stubEnv("GEMINI_MODEL", "synthetic-model");
  vi.stubEnv("CLINICAL_AUDIO_ENABLED", "true");
  vi.stubEnv("RECORDING_STORAGE_PROVIDER", "local");
  vi.stubEnv("CLINICAL_FACTS_ENABLED", "true");
  vi.stubEnv("CLINICAL_RECONCILIATION_ENABLED", "true");
  mocks.actor.mockResolvedValue(actor);
  mocks.authorize.mockResolvedValue({ id: "visit-1", clinicId: "clinic-1" });
  mocks.transcripts.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
  mocks.accepted.mockImplementation(async (_actor, id: string) =>
    id === "t1" ? [accepted("f1", { name: "Paracetamol", strength: "650 mg" }, "s1")] : [accepted("f2", { name: "Metformin" }, "s2")],
  );
  mocks.segments.mockResolvedValue([{ id: "s1", startMs: 83_000 }, { id: "s2", startMs: 1_000 }]);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("AI-4 reconciliation route", () => {
  it("unions accepted facts across the visit's transcripts and attaches audio times", async () => {
    const response = await POST(post({ items: [item], followUpInstructions: "" }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const { data } = await response.json();
    expect(data.acceptedFacts).toBe(2);
    expect(data.results.slice(0, 2)).toMatchObject([
      { check: "STRENGTH", status: "DISCREPANCY", said: "650 mg", draft: "500 mg", evidence: [{ segmentId: "s1", startMs: 83_000 }] },
      { check: "MEDICATION", status: "DISCREPANCY", said: "Metformin", draft: null, evidence: [{ segmentId: "s2", startMs: 1_000 }] },
    ]);
    // Scope comes from the authorized visit, never from the client.
    expect(mocks.transcripts.mock.calls[0][0].where).toEqual({ tenantId: "tenant", registrationId: "visit-1", clinicId: "clinic-1" });
    expect(mocks.authorize).toHaveBeenCalledWith(actor, "visit-1", "clinical-ai:facts-review");
  });

  it.each([
    [new ScopeError(), 404],
    [new PermissionError("linked assigned Doctor identity"), 403],
    [new ClinicalAudioDisabledError(), 403],
    [new Error("Patient Asha: private"), 503],
  ])("maps %s to a fixed %d message", async (error, status) => {
    mocks.authorize.mockRejectedValue(error);
    const response = await POST(post({ items: [], followUpInstructions: "" }), context);
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("Asha");
    expect(mocks.accepted).not.toHaveBeenCalled();
  });

  it("is unavailable while the kill switch is off", async () => {
    vi.stubEnv("CLINICAL_RECONCILIATION_ENABLED", "false");
    expect((await POST(post({ items: [], followUpInstructions: "" }), context)).status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(await mayUseReconciliation(actor, "visit-1")).toBe(false);
  });

  it.each([
    ["unknown keys", { items: [{ ...item, dose: "1 tab" }], followUpInstructions: "" }],
    ["too many items", { items: Array.from({ length: 51 }, () => item), followUpInstructions: "" }],
    ["malformed JSON", "{"],
    ["an oversized body", JSON.stringify({ items: [], followUpInstructions: "x".repeat(200_000) })],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await POST(post(body), context)).status).toBe(400);
    expect(mocks.accepted).not.toHaveBeenCalled();
  });

  it("offers the panel only to an authorized doctor", async () => {
    expect(await mayUseReconciliation(actor, "visit-1")).toBe(true);
    mocks.authorize.mockRejectedValueOnce(new PermissionError("clinical-ai:facts-review"));
    expect(await mayUseReconciliation(actor, "visit-1")).toBe(false);
  });
});
