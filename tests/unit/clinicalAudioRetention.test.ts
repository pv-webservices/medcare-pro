import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), find: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = { $queryRaw: mocks.query, consultationRecording: { findUniqueOrThrow: mocks.find, update: mocks.update, updateMany: mocks.updateMany }, transcriptionRun: { count: mocks.count, update: mocks.update, updateMany: mocks.updateMany } };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/clinical-audio/storage", () => ({ getRecordingStorageProvider: vi.fn() }));
vi.mock("@/lib/transcription/service", () => ({ ACTIVE_TRANSCRIPTION_STATUSES: ["QUEUED", "PREPARING", "SUBMITTED", "PROCESSING"], LEASE_MS: 120000 }));
vi.mock("@/lib/transcription/providers/gemini", () => ({ GeminiTranscriptionProvider: class {} }));
import { cleanupAudioOnce, cleanupProviderArtifactOnce, RETENTION_PROCESSING_GRACE_MS } from "@/lib/clinical-audio/cleanup";
import type { RecordingStorageProvider } from "@/lib/clinical-audio/storage";
describe("Retention policy and provider cleanup", () => {
  let deleteObject: ReturnType<typeof vi.fn>;
  let storage: RecordingStorageProvider;
  beforeEach(() => {
    vi.resetAllMocks();
    const record = { id: "synthetic", tenantId: "tenant", createdByUserId: "clinician", storageKey: "private/synthetic", audioDeleteAfter: new Date(Date.now() - 1000), audioCleanupToken: "claim" };
    mocks.query.mockResolvedValue([{ id: record.id }]); mocks.find.mockResolvedValue(record); mocks.count.mockResolvedValue(0); mocks.update.mockResolvedValue(record); mocks.updateMany.mockResolvedValue({ count: 1 });
    deleteObject = vi.fn().mockResolvedValue(undefined); storage = { deleteObject } as unknown as RecordingStorageProvider;
  });
  it.each(["not expired", "already deleted", "another worker holds the lease"])("does not delete when claim excludes %s", async () => {
    mocks.query.mockResolvedValue([]); expect(await cleanupAudioOnce(storage)).toBe(0); expect(deleteObject).not.toHaveBeenCalled();
  });
  it("marks deletion only after successful storage removal", async () => {
    await cleanupAudioOnce(storage); expect(deleteObject).toHaveBeenCalledOnce(); expect(mocks.updateMany.mock.calls[0][0].data.audioDeletedAt).toBeInstanceOf(Date); expect(mocks.audit.mock.calls[0][1].action).toBe("CLINICAL_AUDIO_RETENTION_DELETED");
  });
  it("confirmed missing object is idempotent deletion", async () => {
    deleteObject.mockRejectedValue(Object.assign(new Error("synthetic"), { name: "NoSuchKey" })); await cleanupAudioOnce(storage); expect(mocks.updateMany.mock.calls[0][0].data.audioDeletedAt).toBeInstanceOf(Date);
  });
  it("outage preserves deletion state and schedules retry without exception details", async () => {
    deleteObject.mockRejectedValue(new Error("private provider body")); await cleanupAudioOnce(storage); expect(mocks.updateMany.mock.calls[0][0].data.audioDeletedAt).toBeUndefined(); expect(mocks.updateMany.mock.calls[0][0].data.audioCleanupNextAttemptAt).toBeInstanceOf(Date); expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("private provider body");
  });
  it("active transcription within grace delays cleanup", async () => {
    mocks.count.mockResolvedValue(1); await cleanupAudioOnce(storage); expect(deleteObject).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("stuck processing past grace is fenced before a full-lease deletion delay", async () => {
    mocks.count.mockResolvedValue(1); mocks.find.mockResolvedValue({ id: "synthetic", tenantId: "tenant", audioDeleteAfter: new Date(Date.now() - RETENTION_PROCESSING_GRACE_MS - 1000) }); await cleanupAudioOnce(storage); expect(deleteObject).not.toHaveBeenCalled(); expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ status: "TIMED_OUT", leaseToken: null, activeKey: null }); expect(mocks.update.mock.calls[0][0].data.audioCleanupNextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 119000);
  });
  it("pending Gemini artifact deletion failure remains retryable", async () => {
    mocks.update.mockResolvedValue({ id: "synthetic", leaseToken: "claim", providerArtifactName: "files/synthetic" }); const deleteFile = vi.fn().mockRejectedValue(new Error("private")); await cleanupProviderArtifactOnce({ deleteFile }); expect(mocks.updateMany.mock.calls[0][0].data.providerArtifactDeletedAt).toBeUndefined(); expect(mocks.updateMany.mock.calls[0][0].data.leaseExpiresAt).toBeInstanceOf(Date);
  });
});
