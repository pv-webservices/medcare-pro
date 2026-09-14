import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RecordingStorageProvider, UploadPart } from "../storage";
import type { ClinicalAudioConfig } from "../config";
export class S3RecordingStorageProvider implements RecordingStorageProvider {
  readonly client: S3Client;
  readonly bucket: string;
  constructor(readonly config: ClinicalAudioConfig) {
    const c = config.s3;
    if (!c) throw new Error("S3_CONFIGURATION");
    this.bucket = c.bucket;
    this.client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: c.forcePathStyle,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  async createMultipartUpload(i: { key: string; contentType: string }) {
    const r = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: i.key,
        ContentType: i.contentType,
        ServerSideEncryption: this.config.s3!.serverSideEncryption,
      }),
    );
    if (!r.UploadId) throw new Error("S3_UPLOAD");
    return { uploadId: r.UploadId };
  }
  async signUploadPart(i: {
    key: string;
    uploadId: string;
    partNumber: number;
    size: number;
  }) {
    return {
      url: await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: i.key,
          UploadId: i.uploadId,
          PartNumber: i.partNumber,
          ContentLength: i.size,
        }),
        { expiresIn: this.config.signedUrlTtlSeconds },
      ),
    };
  }
  async completeMultipartUpload(i: {
    key: string;
    uploadId: string;
    parts: UploadPart[];
  }) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: i.key,
        UploadId: i.uploadId,
        MultipartUpload: {
          Parts: i.parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
    );
  }
  async abortMultipartUpload(i: { key: string; uploadId: string }) {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: i.key,
          UploadId: i.uploadId,
        }),
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NoSuchUpload")
        throw error;
      // Already completed/aborted uploads are safe to abort repeatedly.
    }
  }
  async headObject(i: { key: string }) {
    const r = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: i.key }),
    );
    return { size: r.ContentLength ?? 0, contentType: r.ContentType };
  }
  async getSignedReadUrl(i: { key: string; ttlSeconds: number }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: i.key,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: i.ttlSeconds },
    );
  }
  async getObjectStream(i: { key: string }) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: i.key }));
    if (!result.Body) throw new Error("OBJECT_NOT_FOUND");
    return result.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  }
  async deleteObject(i: { key: string }) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: i.key }),
    );
  }
}
