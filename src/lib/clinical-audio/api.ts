import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { UnauthenticatedError } from "@/lib/session";
import { ScopeError, PermissionError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { ClinicalAudioDisabledError, RecordingStateError } from "./errors";
import { TranscriptionFailure } from "@/lib/transcription/errors";
export function audioJson(data: unknown, status = 200) {
  return NextResponse.json(
    { success: true, data },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
export function audioError(error: unknown) {
  const status =
    error instanceof UnauthenticatedError
      ? 401
      : error instanceof ScopeError
        ? 404
        : error instanceof PermissionError ||
            error instanceof FeatureError ||
            error instanceof ClinicalAudioDisabledError
          ? 403
          : error instanceof RecordingStateError ||
              (error instanceof TranscriptionFailure && ["SOURCE_MISSING", "CONSENT_INVALID"].includes(error.code)) ||
              error instanceof ConflictError
            ? 409
            : error instanceof ZodError ||
                error instanceof BadRequestError ||
                error instanceof SyntaxError
              ? 400
              : 503;
  const message = error instanceof TranscriptionFailure
    ? "Transcription is unavailable. Check retained audio, consent and server configuration."
    :
    status === 401
      ? "You are not signed in."
      : status === 404
        ? "Not found."
        : status === 403
          ? "You do not have access to this recording."
          : status === 409
            ? "Recording state changed. Reload or recover your recording."
            : status === 400
              ? "Check the recording request."
              : "Recording storage is temporarily unavailable. Captured audio remains on this device.";
  // No raw provider/Prisma/browser exception is printed or returned.
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
export async function readAudioJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 100_000) {
      await reader.cancel();
      throw new BadRequestError("Request too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return size ? JSON.parse(new TextDecoder().decode(bytes)) : {};
}
