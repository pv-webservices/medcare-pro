import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { recordingForActor } from "@/lib/clinical-audio/recordingService";
import { getRecordingStorageProvider } from "@/lib/clinical-audio/storage";
import { LocalRecordingStorageProvider } from "@/lib/clinical-audio/storage/local";
import { audioError } from "@/lib/clinical-audio/api";
import { ScopeError } from "@/lib/rbac";
import { withRecordingLock } from "@/lib/clinical-audio/recordingService";
const headers = { "Cache-Control": "private, no-store" };
async function instructions(request: Request) {
  const actor = await requireActor();
  const provider = getRecordingStorageProvider();
  if (!(provider instanceof LocalRecordingStorageProvider))
    throw new ScopeError();
  const token = new URL(request.url).searchParams.get("signature");
  if (!token || token.length > 3000) throw new ScopeError();
  let signed;
  try {
    signed = provider.verify(token);
  } catch {
    throw new ScopeError();
  }
  const recordingId = signed.key.split("/")[2];
  return { actor, provider, signed, recordingId };
}
export async function PUT(request: Request) {
  try {
    const { actor, provider, signed, recordingId } =
      await instructions(request);
    if (
      signed.operation !== "upload" ||
      !signed.uploadId ||
      !signed.partNumber ||
      !signed.size ||
      signed.size > 16 * 1024 * 1024
    )
      throw new ScopeError();
    return await withRecordingLock(actor, recordingId, async (_tx, r) => {
      if (
        r.status !== "UPLOADING" ||
        r.consent.withdrawnAt ||
        r.storageKey !== signed.key ||
        r.uploadId !== signed.uploadId
      )
        throw new ScopeError();
      const reader = request.body?.getReader();
      if (!reader) throw new ScopeError();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > signed.size!) {
          await reader.cancel();
          throw new ScopeError();
        }
        chunks.push(p.value);
      }
      const bytes = Buffer.concat(chunks);
      const etag = await provider.putPart(
        {
          key: signed.key,
          uploadId: signed.uploadId!,
          partNumber: signed.partNumber!,
          size: signed.size!,
        },
        bytes,
      );
      return new NextResponse(null, { headers: { ...headers, ETag: etag } });
    });
  } catch (e) {
    return audioError(e);
  }
}
export async function GET(request: Request) {
  try {
    const { actor, provider, signed, recordingId } =
      await instructions(request);
    if (signed.operation !== "read") throw new ScopeError();
    const r = await recordingForActor(
      actor,
      recordingId,
      "clinical-ai:transcript-read",
      undefined,
      false,
    );
    if (
      r.status !== "READY" ||
      r.audioDeletedAt ||
      r.consent.withdrawnAt ||
      r.storageKey !== signed.key
    )
      throw new ScopeError();
    const head = await provider.headObject({ key: signed.key });
    const range = request.headers.get("Range");
    let start = 0,
      end = head.size - 1;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range && !match)
      return new NextResponse(null, { status: 416, headers });
    if (match) {
      start = Number(match[1]);
      end = match[2]
        ? Number(match[2])
        : Math.min(head.size - 1, start + 8 * 1024 * 1024 - 1);
    }
    if (start < 0 || end < start || end >= head.size)
      return new NextResponse(null, { status: 416, headers });
    return new NextResponse(provider.streamRange(signed.key, start, end), {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "Content-Type": head.contentType,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": "bytes " + start + "-" + end + "/" + head.size }
          : {}),
      },
    });
  } catch (e) {
    return audioError(e);
  }
}
