import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
import {
  RecordingClock,
  selectRecordingMime,
  microphoneMessage,
} from "@/lib/clinical-audio/client/recording";
import {
  saveSession,
  saveChunk,
  readChunks,
  updateSession,
  unfinishedSessions,
  reconstructRecording,
  deleteRecording,
  deleteRecordingChunks,
} from "@/lib/clinical-audio/client/indexedDb";
import { InMemoryRecordingStorage } from "@/lib/clinical-audio/storage";
describe("clinical audio configuration", () => {
  const env = {
    AI_ENABLED: "true",
    CLINICAL_AUDIO_ENABLED: "true",
    RECORDING_STORAGE_PROVIDER: "local",
  };
  it("separate audio kill switch", () =>
    expect(
      getClinicalAudioConfig({ ...env, CLINICAL_AUDIO_ENABLED: "false" }),
    ).toBeNull());
  it("production local storage closed", () =>
    expect(
      getClinicalAudioConfig({ ...env, NODE_ENV: "production" }),
    ).toBeNull());
  it("incomplete S3 closed", () =>
    expect(
      getClinicalAudioConfig({ ...env, RECORDING_STORAGE_PROVIDER: "s3" }),
    ).toBeNull());
  it("default size and duration", () =>
    expect(getClinicalAudioConfig(env)).toMatchObject({
      maxMinutes: 120,
      maxBytes: 536870912,
      signedUrlTtlSeconds: 300,
    }));
  it("invalid duration closed", () =>
    expect(
      getClinicalAudioConfig({ ...env, CLINICAL_RECORDING_MAX_MINUTES: "121" }),
    ).toBeNull());
  it("long-lived URL rejected", () =>
    expect(
      getClinicalAudioConfig({
        ...env,
        RECORDING_SIGNED_URL_TTL_SECONDS: "3600",
      }),
    ).toBeNull());
  it("TLS required for S3", () =>
    expect(
      getClinicalAudioConfig({
        ...env,
        RECORDING_STORAGE_PROVIDER: "s3",
        RECORDING_S3_ENDPOINT: "http://storage.test",
      }),
    ).toBeNull());
});
describe("browser timing and format", () => {
  it("pause excludes paused periods", () => {
    let now = 0;
    const c = new RecordingClock(() => now);
    c.resume();
    now = 1000;
    c.pause();
    now = 5000;
    expect(c.elapsed()).toBe(1000);
    c.resume();
    now = 6500;
    expect(c.elapsed()).toBe(2500);
  });
  it("chooses supported mp4 without assuming webm", () =>
    expect(
      selectRecordingMime({ isTypeSupported: (t) => t === "audio/mp4" }),
    ).toBe("audio/mp4"));
  it("unsupported recorder detected", () =>
    expect(selectRecordingMime({ isTypeSupported: () => false })).toBeNull());
  it("denial has controlled message", () =>
    expect(microphoneMessage("NotAllowedError")).toContain("blocked"));
});
describe("temporary IndexedDB recording", () => {
  const id = "synthetic-recording";
  beforeEach(async () => {
    await deleteRecording(id);
    await saveSession({
      recordingId: id,
      registrationId: "visit",
      mimeType: "audio/webm",
      startedAt: 1,
      updatedAt: 1,
      state: "recording",
      nextSequence: 0,
      elapsedMs: 0,
    });
  });
  const chunk = (n: number) => ({
    recordingId: id,
    sequence: n,
    blob: new Blob([new Uint8Array(1024).fill(n + 1)]),
    size: 1024,
    createdAt: n,
  });
  it("persists ordered blobs and session metadata", async () => {
    await saveChunk(chunk(0), 1000);
    await saveChunk(chunk(1), 2000);
    expect((await readChunks(id)).map((c) => c.sequence)).toEqual([0, 1]);
    expect((await unfinishedSessions("visit"))[0]).toMatchObject({
      nextSequence: 2,
      elapsedMs: 2000,
    });
  });
  it("duplicate sequence rejected atomically", async () => {
    await saveChunk(chunk(0), 100);
    await expect(saveChunk(chunk(0), 100)).rejects.toThrow();
    expect(await readChunks(id)).toHaveLength(1);
  });
  it("missing sequence rejected", async () => {
    await expect(saveChunk(chunk(1), 100)).rejects.toThrow();
    expect(await readChunks(id)).toHaveLength(0);
  });
  it("reconstructs complete playable sequence as one blob", async () => {
    await saveChunk(chunk(0), 100);
    await saveChunk(chunk(1), 200);
    const blob = await reconstructRecording(id, "audio/webm");
    expect(blob.size).toBe(2048);
    expect(blob.type).toBe("audio/webm");
  });
  it("empty recording rejected", async () => {
    await expect(reconstructRecording(id, "audio/webm")).rejects.toThrow();
  });
  it("recovery isolated by registration", async () => {
    expect(await unfinishedSessions("foreign-visit")).toHaveLength(0);
    expect(await unfinishedSessions("visit")).toHaveLength(1);
  });
  it("pause state metadata updates", async () => {
    await updateSession(id, { state: "paused", elapsedMs: 100 });
    expect((await unfinishedSessions("visit"))[0].state).toBe("paused");
  });
  it("successful finalize cleanup removes chunks and session", async () => {
    await saveChunk(chunk(0), 100);
    await deleteRecording(id);
    expect(await readChunks(id)).toHaveLength(0);
    expect(await unfinishedSessions("visit")).toHaveLength(0);
  });
  it("withdrawal removes audio but retains pending withdrawal marker", async () => {
    await saveChunk(chunk(0), 100);
    await updateSession(id, { state: "withdrawn" });
    await deleteRecordingChunks(id);
    expect(await readChunks(id)).toHaveLength(0);
    expect((await unfinishedSessions("visit"))[0].state).toBe("withdrawn");
  });
});
describe("private deterministic test storage", () => {
  it("preserves bytes, MIME and checksum", async () => {
    const s = new InMemoryRecordingStorage();
    const { uploadId } = await s.createMultipartUpload({
      key: "opaque",
      contentType: "audio/webm",
    });
    const etag = await s.putPart(uploadId, 1, new Uint8Array(2048));
    await s.completeMultipartUpload({
      key: "opaque",
      uploadId,
      parts: [{ partNumber: 1, etag }],
    });
    expect(await s.headObject({ key: "opaque" })).toMatchObject({
      size: 2048,
      contentType: "audio/webm",
    });
  });
  it("rejects modified ETag", async () => {
    const s = new InMemoryRecordingStorage();
    const { uploadId } = await s.createMultipartUpload({
      key: "opaque",
      contentType: "audio/webm",
    });
    await s.putPart(uploadId, 1, new Uint8Array(2048));
    await expect(
      s.completeMultipartUpload({
        key: "opaque",
        uploadId,
        parts: [{ partNumber: 1, etag: "invalid" }],
      }),
    ).rejects.toThrow();
  });
  it("abort removes parts", async () => {
    const s = new InMemoryRecordingStorage();
    const { uploadId } = await s.createMultipartUpload({
      key: "opaque",
      contentType: "audio/webm",
    });
    await s.abortMultipartUpload({ key: "opaque", uploadId });
    expect(s.uploads.size).toBe(0);
  });
});
