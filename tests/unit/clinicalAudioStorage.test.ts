import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
import { LocalRecordingStorageProvider } from "@/lib/clinical-audio/storage/local";
import { S3RecordingStorageProvider } from "@/lib/clinical-audio/storage/s3";
const key = "clinical-recordings/opaque-tenant/opaque-recording/source.webm";
async function local() {
  const root = await mkdtemp(join(tmpdir(), "medcare-audio-adapter-"));
  return new LocalRecordingStorageProvider(
    getClinicalAudioConfig({
      CLINICAL_AUDIO_ENABLED: "true",
      RECORDING_STORAGE_PROVIDER: "local",
      RECORDING_LOCAL_ROOT: root,
      RECORDING_LOCAL_SIGNING_SECRET: "synthetic-signing-secret",
    })!,
  );
}
describe("clinical audio private adapters", () => {
  it("rejects expired signed tokens", async () => {
    const p = await local();
    expect(() =>
      p.verify(p.token({ key, operation: "read", expires: Date.now() - 1000 })),
    ).toThrow("EXPIRED");
  });
  it("rejects tampered signatures", async () => {
    const p = await local();
    const t = p.token({ key, expires: Date.now() + 1000 });
    expect(() =>
      p.verify(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0")),
    ).toThrow("BAD_SIGNATURE");
  });
  it("rejects traversal keys", async () => {
    const p = await local();
    await expect(
      p.createMultipartUpload({
        key: "../../public/audio.webm",
        contentType: "audio/webm",
      }),
    ).rejects.toThrow("INVALID_KEY");
  });
  it("rejects wrong-size parts", async () => {
    const p = await local();
    const u = await p.createMultipartUpload({ key, contentType: "audio/webm" });
    await expect(
      p.putPart({ key, ...u, partNumber: 1, size: 100 }, new Uint8Array(10)),
    ).rejects.toThrow("PART_INVALID");
    await p.abortMultipartUpload(u);
  });
  it("verifies ETags and computes complete-object SHA256", async () => {
    const p = await local();
    const u = await p.createMultipartUpload({ key, contentType: "audio/webm" });
    const bytes = new Uint8Array(2048).fill(71);
    const etag = await p.putPart(
      { key, ...u, partNumber: 1, size: bytes.length },
      bytes,
    );
    await p.completeMultipartUpload({
      key,
      ...u,
      parts: [{ partNumber: 1, etag }],
    });
    expect(await p.headObject({ key })).toMatchObject({
      size: 2048,
      contentType: "audio/webm",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await p.deleteObject({ key });
    await expect(p.headObject({ key })).rejects.toThrow();
  });
  it("requests S3 server-side encryption without public ACL", async () => {
    const config = getClinicalAudioConfig({
      CLINICAL_AUDIO_ENABLED: "true",
      RECORDING_STORAGE_PROVIDER: "s3",
      RECORDING_S3_ENDPOINT: "https://synthetic.invalid",
      RECORDING_S3_REGION: "synthetic-region",
      RECORDING_S3_BUCKET: "private-test-bucket",
      RECORDING_S3_ACCESS_KEY_ID: "synthetic-key",
      RECORDING_S3_SECRET_ACCESS_KEY: "synthetic-secret",
    })!;
    const p = new S3RecordingStorageProvider(config);
    const send = vi
      .spyOn(p.client, "send")
      .mockResolvedValue({ UploadId: "opaque-upload" } as never);
    await p.createMultipartUpload({ key, contentType: "audio/webm" });
    expect((send.mock.calls[0][0] as { input: object }).input).toMatchObject({
      ServerSideEncryption: "AES256",
      ContentType: "audio/webm",
    });
    expect(
      (send.mock.calls[0][0] as { input: object }).input,
    ).not.toHaveProperty("ACL");
    send.mockRejectedValueOnce(
      Object.assign(new Error("synthetic already aborted"), {
        name: "NoSuchUpload",
      }),
    );
    await expect(
      p.abortMultipartUpload({ key, uploadId: "opaque-upload" }),
    ).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error("synthetic provider outage"));
    await expect(
      p.abortMultipartUpload({ key, uploadId: "opaque-upload" }),
    ).rejects.toThrow("synthetic provider outage");
    p.client.destroy();
  });
});
