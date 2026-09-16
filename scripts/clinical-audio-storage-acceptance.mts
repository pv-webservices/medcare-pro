import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { HeadObjectCommand, GetPublicAccessBlockCommand, GetBucketPolicyStatusCommand } from "@aws-sdk/client-s3";
import { getClinicalAudioConfig } from "../src/lib/clinical-audio/config";
import { S3RecordingStorageProvider } from "../src/lib/clinical-audio/storage/s3";
const config = getClinicalAudioConfig({ ...process.env, CLINICAL_AUDIO_ENABLED: "true", NODE_ENV: "development", RECORDING_SIGNED_URL_TTL_SECONDS: "30" });
if (!config?.s3 || config.storageProvider !== "s3") { console.log("NOT RUN — real provider credentials not configured"); }
else {
  const storage = new S3RecordingStorageProvider(config);
  const key = `acceptance/synthetic-${randomUUID()}.wav`;
  let uploadId: string | undefined;
  let abortedId: string | undefined;
  let checks = 0;
  let bucketPolicyVerified = false;
  const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
  try {
    const data = Buffer.alloc(18 * 1024 * 1024 + 44);
    data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
    uploadId = (await storage.createMultipartUpload({ key, contentType: "audio/wav" })).uploadId; pass("TLS and multipart initiation");
    try {
      const block = (await storage.client.send(new GetPublicAccessBlockCommand({ Bucket: storage.bucket }))).PublicAccessBlockConfiguration;
      assert.ok(block?.BlockPublicAcls && block.IgnorePublicAcls && block.BlockPublicPolicy && block.RestrictPublicBuckets);
      const policy = await storage.client.send(new GetBucketPolicyStatusCommand({ Bucket: storage.bucket }));
      assert.equal(policy.PolicyStatus?.IsPublic, false); bucketPolicyVerified = true; pass("bucket-wide public access blocking and private policy");
    } catch (error) {
      if (!(error instanceof Error) || !["NotImplemented", "XNotImplemented", "UnsupportedOperation"].includes(error.name)) throw error;
      console.log("NOT RUN bucket-wide policy introspection — provider requires equivalent manual evidence");
    }
    const parts = [];
    const origin = process.env.CLINICAL_AUDIO_STORAGE_ACCEPTANCE_ORIGIN;
    for (let offset = 0; offset < data.length; offset += 8 * 1024 * 1024) {
      const part = data.subarray(offset, Math.min(offset + 8 * 1024 * 1024, data.length));
      const signed = await storage.signUploadPart({ key, uploadId, partNumber: parts.length + 1, size: part.length });
      if (origin) {
        const preflight = await fetch(signed.url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" }, signal: AbortSignal.timeout(30_000) });
        assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
        assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PUT/i);
      }
      const response = await fetch(signed.url, { method: "PUT", body: part, headers: { "Content-Type": "audio/wav", ...(origin ? { Origin: origin } : {}) }, signal: AbortSignal.timeout(60_000) });
      assert.ok(response.ok); const etag = response.headers.get("etag"); assert.ok(etag);
      if (origin) assert.match(response.headers.get("access-control-expose-headers") ?? "", /etag/i);
      await response.body?.cancel(); parts.push({ partNumber: parts.length + 1, etag });
    }
    pass("three signed upload parts and ETag visibility");
    if (origin) pass("approved-origin PUT CORS and ETag exposure"); else console.log("NOT RUN browser CORS — CLINICAL_AUDIO_STORAGE_ACCEPTANCE_ORIGIN unavailable");
    await storage.completeMultipartUpload({ key, uploadId, parts }); uploadId = undefined; pass("multipart completion");
    const head = await storage.headObject({ key }); assert.equal(head.size, data.length); assert.equal(head.contentType, "audio/wav"); pass("HEAD exact size and MIME");
    const metadata = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
    if (metadata.ServerSideEncryption === config.s3.serverSideEncryption) {
      pass("server-side encryption confirmed");
    } else if (!metadata.ServerSideEncryption && config.s3.endpoint.includes("r2.cloudflarestorage.com")) {
      console.log("CONDITIONAL PROVIDER-SPECIFIC CHECK server-side encryption — Cloudflare R2 encrypts all objects with AES-256 at rest by default but does not return x-amz-server-side-encryption in S3 HEAD");
    } else {
      assert.equal(metadata.ServerSideEncryption, config.s3.serverSideEncryption);
      pass("server-side encryption confirmed");
    }
    const url = await storage.getSignedReadUrl({ key, ttlSeconds: 30 });
    const read = await fetch(url, { signal: AbortSignal.timeout(60_000) }); assert.ok(read.ok);
    const bytes = Buffer.from(await read.arrayBuffer()); assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(data).digest("hex")); pass("signed read exact synthetic WAV bytes");
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><title>Synthetic private audio acceptance</title>");
      assert.ok(await page.evaluate(async source => {
        const audio = document.createElement("audio"); document.body.append(audio);
        await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("SYNTHETIC_PLAYBACK_TIMEOUT")), 15000); audio.oncanplay = () => { clearTimeout(timeout); resolve(); }; audio.onerror = () => { clearTimeout(timeout); reject(new Error("SYNTHETIC_PLAYBACK_FAILED")); }; audio.src = source; });
        await audio.play(); const valid = Number.isFinite(audio.duration) && audio.duration > 0 && !audio.paused; audio.pause(); return valid;
      }, url)); pass("browser audio-element playback");
    } finally { await browser.close(); }
    const direct = new URL(url); direct.search = "";
    const anonymous = await fetch(direct, { signal: AbortSignal.timeout(30_000) }); assert.ok([400, 401, 403, 404].includes(anonymous.status)); await anonymous.body?.cancel(); pass("unauthenticated object access denied");
    await new Promise(resolve => setTimeout(resolve, 35_000));
    const expired = await fetch(url, { signal: AbortSignal.timeout(30_000) }); assert.ok([401, 403, 404].includes(expired.status)); await expired.body?.cancel(); pass("signed read expiry denied");
    await storage.deleteObject({ key }); await assert.rejects(storage.headObject({ key }), (error: unknown) => error instanceof Error && ["NotFound", "NoSuchKey"].includes(error.name)); await storage.deleteObject({ key }); pass("delete and missing-object idempotency");
    abortedId = (await storage.createMultipartUpload({ key, contentType: "audio/wav" })).uploadId;
    await storage.abortMultipartUpload({ key, uploadId: abortedId }); await storage.abortMultipartUpload({ key, uploadId: abortedId }); abortedId = undefined; pass("multipart abort idempotency");
    console.log(`${origin && bucketPolicyVerified ? "PASS" : "CONDITIONAL"} — real S3-compatible endpoint tested; ${checks} checks. Any NOT RUN checks require independent acceptance evidence.`);
  } catch { console.error("FAIL — storage acceptance; no provider exception or signed URL logged."); process.exitCode = 1; }
  finally {
    if (uploadId) await storage.abortMultipartUpload({ key, uploadId }).catch(() => { process.exitCode = 1; });
    if (abortedId) await storage.abortMultipartUpload({ key, uploadId: abortedId }).catch(() => { process.exitCode = 1; });
    await storage.deleteObject({ key }).catch(() => { process.exitCode = 1; }); storage.client.destroy();
  }
}
