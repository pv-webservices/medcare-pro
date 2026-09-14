import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readBoundedProviderJson } from "@/lib/transcription/normalize";
import { TranscriptionFailure } from "@/lib/transcription/errors";
import { ACTIVE_TRANSCRIPTION_STATUSES } from "@/lib/transcription/types";
const hintSchema = z.object({ job_id: z.string().min(1).max(255), job_state: z.enum(["Accepted", "Pending", "Running", "Completed", "Failed"]) });
export async function POST(request: Request) {
  const secret = process.env.SARVAM_WEBHOOK_SECRET;
  const supplied = request.headers.get("X-SARVAM-JOB-CALLBACK-TOKEN");
  // Authenticate BEFORE body parsing or database lookup. Fixed bounded buffers only.
  if (!secret || secret.length < 32 || secret.length > 512 || !supplied || supplied.length > 512) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const expected = Buffer.from(secret); const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const hint = hintSchema.parse(await readBoundedProviderJson(new Response(request.body), 100_000));
    await prisma.transcriptionRun.updateMany({ where: { provider: "SARVAM", providerJobId: hint.job_id, status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] }, OR: [{ callbackState: null }, { callbackState: { not: hint.job_state } }] }, data: { callbackState: hint.job_state, nextAttemptAt: new Date() } });
    // Unknown/terminal/duplicate notifications all acknowledge safely. No transcript IO.
    return NextResponse.json({ success: true, data: { acknowledged: true } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return new Response(null, { status: error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof TranscriptionFailure && error.code === "INVALID_RESPONSE") ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
