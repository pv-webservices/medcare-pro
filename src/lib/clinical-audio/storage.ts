import { createHash } from "node:crypto";

export interface RecordingStorageProvider {
  createMultipartUpload(input: { key: string; contentType: string }): Promise<{ uploadId: string }>;
  signUploadPart(input: { key: string; uploadId: string; partNumber: number }): Promise<{ url: string }>;
  completeMultipartUpload(input: { key: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> }): Promise<void>;
  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
  headObject(input: { key: string }): Promise<{ size: number; sha256?: string }>;
  getSignedReadUrl(input: { key: string; ttlSeconds: number }): Promise<string>;
  deleteObject(input: { key: string }): Promise<void>;
}

/** Deterministic test provider; it never contacts a network or persists clinical audio. */
export class InMemoryRecordingStorage implements RecordingStorageProvider {
  private readonly objects = new Map<string, Uint8Array>();
  private readonly uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  async createMultipartUpload(input: { key: string }) { const uploadId = `memory-${crypto.randomUUID()}`; this.uploads.set(uploadId, { key: input.key, parts: new Map() }); return { uploadId }; }
  async signUploadPart(input: { uploadId: string; partNumber: number }) { return { url: `memory://${input.uploadId}/${input.partNumber}` }; }
  async completeMultipartUpload(input: { key: string; uploadId: string }) { const upload = this.uploads.get(input.uploadId); if (!upload || upload.key !== input.key) throw new Error("UPLOAD_NOT_FOUND"); this.objects.set(input.key, new Uint8Array()); this.uploads.delete(input.uploadId); }
  async abortMultipartUpload(input: { uploadId: string }) { this.uploads.delete(input.uploadId); }
  async headObject(input: { key: string }) { const data = this.objects.get(input.key); if (!data) throw new Error("OBJECT_NOT_FOUND"); return { size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") }; }
  async getSignedReadUrl(input: { key: string }) { if (!this.objects.has(input.key)) throw new Error("OBJECT_NOT_FOUND"); return `memory://${encodeURIComponent(input.key)}`; }
  async deleteObject(input: { key: string }) { this.objects.delete(input.key); }
}

export function getRecordingStorageProvider(): RecordingStorageProvider {
  if (process.env.RECORDING_STORAGE_PROVIDER === "memory" && process.env.NODE_ENV !== "production") return new InMemoryRecordingStorage();
  throw new Error("RECORDING_STORAGE_UNAVAILABLE");
}
