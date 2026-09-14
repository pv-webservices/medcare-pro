import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  stat,
  open,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RecordingStorageProvider, UploadPart } from "../storage";
import type { ClinicalAudioConfig } from "../config";
export class LocalRecordingStorageProvider implements RecordingStorageProvider {
  readonly root: string;
  constructor(readonly config: ClinicalAudioConfig) {
    if (process.env.NODE_ENV === "production")
      throw new Error("LOCAL_DISABLED");
    this.root = resolve(config.localRoot);
    const publicRoot = resolve("public");
    if (this.root === publicRoot || this.root.startsWith(publicRoot + sep))
      throw new Error("PRIVATE_ROOT_REQUIRED");
  }
  private path(key: string) {
    if (
      !/^(clinical-recordings\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/source\.(webm|ogg|mp4)|multipart\/[a-f0-9-]+\/(metadata|part-[1-9][0-9]*))$/.test(
        key,
      )
    )
      throw new Error("INVALID_KEY");
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error("INVALID_KEY");
    return p;
  }
  async createMultipartUpload(i: { key: string; contentType: string }) {
    this.path(i.key);
    const uploadId = randomUUID();
    await mkdir(resolve(this.root, "multipart", uploadId), { recursive: true });
    await writeFile(
      this.path("multipart/" + uploadId + "/metadata"),
      JSON.stringify(i),
      { flag: "wx" },
    );
    return { uploadId };
  }
  token(data: object) {
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    return (
      payload +
      "." +
      createHmac("sha256", this.config.localSecret)
        .update(payload)
        .digest("hex")
    );
  }
  verify(token: string) {
    const [payload, mac] = token.split(".");
    if (!payload || !mac || !/^[a-f0-9]{64}$/.test(mac))
      throw new Error("BAD_SIGNATURE");
    const expected = createHmac("sha256", this.config.localSecret)
      .update(payload)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(mac, "hex")))
      throw new Error("BAD_SIGNATURE");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      key: string;
      expires: number;
      operation: string;
      uploadId?: string;
      partNumber?: number;
      size?: number;
    };
    if (data.expires < Date.now()) throw new Error("EXPIRED");
    this.path(data.key);
    return data;
  }
  async signUploadPart(i: {
    key: string;
    uploadId: string;
    partNumber: number;
    size: number;
  }) {
    return {
      url:
        "/api/clinical-ai/local-storage?signature=" +
        this.token({
          ...i,
          operation: "upload",
          expires: Date.now() + this.config.signedUrlTtlSeconds * 1000,
        }),
    };
  }
  async putPart(
    i: { key: string; uploadId: string; partNumber: number; size: number },
    bytes: Uint8Array,
  ) {
    const meta = JSON.parse(
      await readFile(
        this.path("multipart/" + i.uploadId + "/metadata"),
        "utf8",
      ),
    );
    if (meta.key !== i.key || bytes.length !== i.size)
      throw new Error("PART_INVALID");
    await writeFile(
      this.path("multipart/" + i.uploadId + "/part-" + i.partNumber),
      bytes,
    );
    return '"' + createHash("md5").update(bytes).digest("hex") + '"';
  }
  async completeMultipartUpload(i: {
    key: string;
    uploadId: string;
    parts: UploadPart[];
  }) {
    const meta = JSON.parse(
      await readFile(
        this.path("multipart/" + i.uploadId + "/metadata"),
        "utf8",
      ),
    );
    if (meta.key !== i.key) throw new Error("UPLOAD_INVALID");
    const target = this.path(i.key);
    await mkdir(resolve(target, ".."), { recursive: true });
    const file = await open(target, "w");
    const hash = createHash("sha256");
    try {
      for (const p of i.parts) {
        const bytes = await readFile(
          this.path("multipart/" + i.uploadId + "/part-" + p.partNumber),
        );
        if (
          '"' + createHash("md5").update(bytes).digest("hex") + '"' !==
          p.etag
        )
          throw new Error("PART_INVALID");
        hash.update(bytes);
        await file.write(bytes);
      }
    } finally {
      await file.close();
    }
    await writeFile(
      target + ".metadata",
      JSON.stringify({
        contentType: meta.contentType,
        sha256: hash.digest("hex"),
      }),
    );
    await this.abortMultipartUpload(i);
  }
  async abortMultipartUpload(i: { uploadId: string }) {
    const metadata = this.path("multipart/" + i.uploadId + "/metadata");
    let metaExists = true;
    try {
      await stat(metadata);
    } catch {
      metaExists = false;
    }
    if (!metaExists) return;
    const { readdir, rmdir } = await import("node:fs/promises");
    const folder = resolve(metadata, "..");
    for (const name of await readdir(folder)) {
      if (name === "metadata" || /^part-[1-9][0-9]*$/.test(name))
        await unlink(resolve(folder, name));
    }
    await rmdir(folder);
  }
  async headObject(i: { key: string }) {
    const size = (await stat(this.path(i.key))).size;
    const meta = JSON.parse(
      await readFile(this.path(i.key) + ".metadata", "utf8"),
    );
    return {
      size,
      contentType: meta.contentType as string,
      sha256: meta.sha256 as string,
    };
  }
  async getSignedReadUrl(i: { key: string; ttlSeconds: number }) {
    return (
      "/api/clinical-ai/local-storage?signature=" +
      this.token({
        key: i.key,
        operation: "read",
        expires: Date.now() + i.ttlSeconds * 1000,
      })
    );
  }
  async readRange(key: string, start: number, end: number) {
    const file = await open(this.path(key), "r");
    try {
      const bytes = Buffer.alloc(end - start + 1);
      await file.read(bytes, 0, bytes.length, start);
      return bytes;
    } finally {
      await file.close();
    }
  }
  streamRange(key: string, start: number, end: number) {
    return Readable.toWeb(
      createReadStream(this.path(key), { start, end }),
    ) as ReadableStream<Uint8Array>;
  }
  async getObjectStream(i: { key: string }) {
    const head = await this.headObject(i);
    if (head.size <= 0) throw new Error("OBJECT_NOT_FOUND");
    return this.streamRange(i.key, 0, head.size - 1);
  }
  async deleteObject(i: { key: string }) {
    await unlink(this.path(i.key)).catch(() => {});
    await unlink(this.path(i.key) + ".metadata").catch(() => {});
  }
}
