import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ConflictError } from "@/lib/domainErrors";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { ClinicalFactsDisabledError } from "@/lib/clinical-facts/config";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  list: vi.fn(),
  request: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireActor: mocks.actor,
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/clinical-facts/service", () => ({
  listTranscriptFacts: mocks.list,
  requestFactExtraction: mocks.request,
  reviewFact: mocks.review,
}));

import { GET as listFacts, POST as extractFacts } from "@/app/api/clinical-ai/transcripts/[transcriptId]/facts/route";
import { POST as reviewFactRoute } from "@/app/api/clinical-ai/facts/[factId]/review/route";

const actor = { userId: "doctor", tenantId: "tenant" };
const transcriptContext = { params: Promise.resolve({ transcriptId: "transcript-1" }) };
const factContext = { params: Promise.resolve({ factId: "fact-1" }) };
const post = (body: unknown) =>
  new Request("https://example.test/review", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => mocks.actor.mockResolvedValue(actor));
afterEach(() => vi.clearAllMocks());

describe("fact extraction routes", () => {
  it("returns 202 for a new run and 200 for an idempotent repeat", async () => {
    mocks.request.mockResolvedValueOnce({ run: { id: "r1" }, created: true }).mockResolvedValueOnce({ run: { id: "r1" }, created: false });
    expect((await extractFacts(new Request("https://example.test"), transcriptContext)).status).toBe(202);
    expect((await extractFacts(new Request("https://example.test"), transcriptContext)).status).toBe(200);
    expect(mocks.request).toHaveBeenCalledWith(actor, "transcript-1");
  });

  it("never exposes response caching", async () => {
    mocks.list.mockResolvedValue({ canExtract: true, run: null, facts: [] });
    const response = await listFacts(new Request("https://example.test"), transcriptContext);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it.each([
    [new ScopeError(), 404, "Not found."],
    [new PermissionError("clinical-ai:facts-extract"), 403, "Clinical fact extraction is not available for this consultation."],
    [new ClinicalFactsDisabledError(), 403, "Clinical fact extraction is not available for this consultation."],
    [new ConflictError("Review the transcript before extracting facts."), 409, "Review the transcript before extracting facts."],
    [new Error("Patient Asha: raw provider payload"), 503, "Clinical fact extraction is temporarily unavailable."],
  ])("maps %s to a fixed, PHI-free response", async (error, status, message) => {
    mocks.list.mockRejectedValue(error);
    const response = await listFacts(new Request("https://example.test"), transcriptContext);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error: message });
  });
});

describe("fact review route", () => {
  it("accepts one explicit decision for one fact", async () => {
    mocks.review.mockResolvedValue({ saved: true, decision: "ACCEPTED" });
    const response = await reviewFactRoute(post({ decision: "ACCEPTED" }), factContext);
    expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(actor, "fact-1", { decision: "ACCEPTED" });
  });

  it.each([
    [{ decision: "ACCEPT_ALL" }],
    [{ decision: "ACCEPTED", factIds: ["fact-1", "fact-2"] }],
    [{ decision: "ACCEPTED", tenantId: "spoof" }],
    [{ decision: "DISMISSED", reason: "x".repeat(501) }],
    [{}],
  ])("rejects bulk, spoofed or malformed input %j", async (body) => {
    const response = await reviewFactRoute(post(body), factContext);
    expect(response.status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("maps validation errors raised deeper to 400", async () => {
    mocks.review.mockRejectedValue(new ZodError([]));
    expect((await reviewFactRoute(post({ decision: "DISMISSED" }), factContext)).status).toBe(400);
  });
});
