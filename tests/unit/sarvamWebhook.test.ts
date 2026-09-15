import { afterEach, describe, expect, it, vi } from "vitest";
const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { transcriptionRun: { updateMany } } }));
import { POST } from "@/app/api/clinical-ai/transcription/webhooks/sarvam/route";

afterEach(() => { vi.unstubAllEnvs(); updateMany.mockClear(); });
describe("Sarvam authenticated status hints", () => {
  it.each([undefined, "", "wrong", "x".repeat(513)])("rejects invalid authentication before body access: %s", async (token) => {
    vi.stubEnv("SARVAM_WEBHOOK_SECRET", "s".repeat(32));
    const request = new Request("https://example.test/webhook", { method: "POST", headers: token ? { "X-SARVAM-JOB-CALLBACK-TOKEN": token } : {} });
    const body = vi.fn(() => { throw new Error("must not read body"); });
    Object.defineProperty(request, "body", { get: body });
    expect((await POST(request)).status).toBe(403);
    expect(body).not.toHaveBeenCalled(); expect(updateMany).not.toHaveBeenCalled();
  });
  it("acknowledges unknown jobs without creating or completing rows", async () => {
    vi.stubEnv("SARVAM_WEBHOOK_SECRET", "s".repeat(32));
    const request = () => new Request("https://example.test/webhook", { method: "POST", headers: { "X-SARVAM-JOB-CALLBACK-TOKEN": "s".repeat(32) }, body: JSON.stringify({ job_id: "unknown", job_state: "Completed", transcript: "untrusted text ignored" }) });
    for (let count = 0; count < 10; count++) expect((await POST(request())).status).toBe(200);
    expect(updateMany).toHaveBeenCalledTimes(10);
    const input = updateMany.mock.calls[0][0];
    expect(input.where.providerJobId).toBe("unknown");
    expect(input.where.status.in).not.toContain("COMPLETED");
    expect(input.where.OR).toContainEqual({ callbackState: { not: "Completed" } });
    expect(input.data.status).toBeUndefined(); expect(JSON.stringify(input)).not.toContain("untrusted text");
  });
  it("rejects malformed authenticated payload", async () => {
    vi.stubEnv("SARVAM_WEBHOOK_SECRET", "s".repeat(32));
    const response = await POST(new Request("https://example.test/webhook", { method: "POST", headers: { "X-SARVAM-JOB-CALLBACK-TOKEN": "s".repeat(32) }, body: JSON.stringify({ job_id: "job", job_state: "made-up" }) }));
    expect(response.status).toBe(400); expect(updateMany).not.toHaveBeenCalled();
  });
});
