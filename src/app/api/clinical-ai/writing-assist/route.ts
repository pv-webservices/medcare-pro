import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { AiError } from "@/lib/ai/errors";
import { requestWritingAssistance } from "@/lib/clinical-ai/writingAssistant";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    // Bound streaming bodies as well as Content-Length (untrusted/optional).
    const reader = request.body?.getReader();
    if (!reader) throw new ZodError([]);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 40000) {
        await reader.cancel();
        return NextResponse.json(
          { success: false, error: "Request too large." },
          { status: 413, headers },
        );
      }
      chunks.push(p.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const data = await requestWritingAssistance(
      actor,
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return NextResponse.json({ success: true, data }, { headers });
  } catch (error) {
    const status =
      error instanceof UnauthenticatedError
        ? 401
        : error instanceof ScopeError
          ? 404
          : error instanceof PermissionError || error instanceof FeatureError
            ? 403
            : error instanceof ZodError || error instanceof SyntaxError
              ? 400
              : error instanceof AiError && error.code === "RATE_LIMIT"
                ? 429
                : 503;
    const message =
      status === 401
        ? "You are not signed in."
        : status === 404
          ? "Not found."
          : status === 403
            ? "You do not have access to clinical writing assistance."
            : status === 400
              ? "Check the writing assistance request."
              : status === 429
                ? "Too many requests. Please try again later."
                : "AI writing assistance is temporarily unavailable. Your clinical note has not been changed.";
    return NextResponse.json(
      { success: false, error: message },
      { status, headers },
    );
  }
}
