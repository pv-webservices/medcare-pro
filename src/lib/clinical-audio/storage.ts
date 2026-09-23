import { createHash, randomUUID } from "node:crypto";
import { getClinicalAudioConfig } from "./config";
import { LocalRecordingStorageProvider } from "./storage/local";
import { S3RecordingStorageProvider } from "./storage/s3";
export type StorageHead = {
  size: number;
  contentType?: string;
  sha256?: string;
};
export type UploadPart = { partNumber: number; etag: string };
export interface RecordingStorageProvider {
  createMultipartUpload(input: {
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }>;
  signUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    size: number;
  }): Promise<{ url: string }>;
  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: UploadPart[];
  }): Promise<void>;
  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
  headObject(input: { key: string }): Promise<StorageHead>;
  /** Internal worker-only access. Never return this stream from metadata APIs. */
  getObjectStream(input: { key: string }): Promise<ReadableStream<Uint8Array>>;
  getSignedReadUrl(input: { key: string; ttlSeconds: number }): Promise<string>;
  deleteObject(input: { key: string }): Promise<void>;
}
export class InMemoryRecordingStorage implements RecordingStorageProvider {
  readonly objects = new Map<
    string,
    { data: Uint8Array; contentType: string }
  >();
  readonly uploads = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, Uint8Array> }
  >();
  async createMultipartUpload(i: { key: string; contentType: string }) {
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { ...i, parts: new Map() });
    return { uploadId };
  }
  async signUploadPart(i: {
    key: string;
    uploadId: string;
    partNumber: number;
    size: number;
  }) {
    return { url: "memory://" + i.uploadId + "/" + i.partNumber };
  }
  async putPart(uploadId: string, n: number, data: Uint8Array) {
    const u = this.uploads.get(uploadId);
    if (!u) throw new Error("UPLOAD_NOT_FOUND");
    u.parts.set(n, data);
    return '"' + createHash("md5").update(data).digest("hex") + '"';
  }
  async completeMultipartUpload(i: {
    key: string;
    uploadId: string;
    parts: UploadPart[];
  }) {
    const u = this.uploads.get(i.uploadId);
    if (!u || u.key !== i.key) throw new Error("UPLOAD_NOT_FOUND");
    const parts = i.parts.map((p) => {
      const data = u.parts.get(p.partNumber);
      if (
        !data ||
        '"' + createHash("md5").update(data).digest("hex") + '"' !== p.etag
      )
        throw new Error("PART_INVALID");
      return data;
    });
    this.objects.set(i.key, {
      data: Buffer.concat(parts),
      contentType: u.contentType,
    });
    this.uploads.delete(i.uploadId);
  }
  async abortMultipartUpload(i: { uploadId: string; key?: string }) {
    this.uploads.delete(i.uploadId);
  }
  async headObject(i: { key: string }) {
    const o = this.objects.get(i.key);
    if (!o) throw new Error("OBJECT_NOT_FOUND");
    return {
      size: o.data.byteLength,
      contentType: o.contentType,
      sha256: createHash("sha256").update(o.data).digest("hex"),
    };
  }
  async getSignedReadUrl(i: { key: string; ttlSeconds: number }) {
    return "memory://" + i.key;
  }
  async getObjectStream(i: { key: string }) {
    const object = this.objects.get(i.key);
    if (!object) throw new Error("OBJECT_NOT_FOUND");
    let offset = 0;
    return new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= object.data.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, object.data.length);
      controller.enqueue(object.data.slice(offset, end));
      offset = end;
    } });
  }
  async deleteObject(i: { key: string }) {
    this.objects.delete(i.key);
  }
}
const globalForMemory = globalThis as unknown as {
  __medcareInMemoryRecordingStorage: InMemoryRecordingStorage | undefined;
};
export function getRecordingStorageProvider(): RecordingStorageProvider {
  const c = getClinicalAudioConfig();
  if (!c) throw new Error("STORAGE_UNAVAILABLE");
  if (c.storageProvider === "s3" && c.s3)
    return new S3RecordingStorageProvider(c);
  if (c.storageProvider === "local" && process.env.NODE_ENV !== "production")
    return new LocalRecordingStorageProvider(c);
  if (c.storageProvider === "memory" && process.env.NODE_ENV !== "production")
    return (globalForMemory.__medcareInMemoryRecordingStorage ??=
      new InMemoryRecordingStorage());
  throw new Error("STORAGE_UNAVAILABLE");
}
