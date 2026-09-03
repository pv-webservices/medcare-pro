import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { UnauthenticatedError } from "@/lib/session";
import { PlatformAuthorizationError } from "@/lib/platform/context";
import { RateLimitError } from "@/lib/rateLimit";
import type { ApiResponse } from "@/lib/utils";
import {
  MediaConfigurationError,
  MediaFileMissingError,
  MediaAccessError,
} from "@/lib/mediaTypes";
import { InvalidTokenError } from "@/lib/mediaSecurity";

/**
 * Shared error mapping for API routes.
 *
 * Kept in one place so every route answers the same way: a permission failure
 * is always 403, an out-of-tenant id is always 404 (never 403, which would
 * confirm the record exists), and an unexpected error never reaches the client
 * as a stack trace.
 */

/** Thrown for client-side mistakes that are not schema violations. Maps to 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/**
 * Thrown when a write conflicts with data already stored — e.g. an availability
 * window overlapping one already set. Maps to 409, and its message is shown to
 * the user, so phrase it for them.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Reads and JSON-parses a request body, turning a malformed one into a 400
 * rather than letting the parse error fall through as a 500.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("Malformed request body.");
  }
}

/**
 * Reads a JSON body that a caller is allowed to omit entirely.
 *
 * `readJsonBody` treats an empty body as malformed, which is right for a
 * create or an update — a POST with nothing in it is a mistake. It is wrong for
 * an action endpoint whose only field is optional: cancelling an appointment
 * without giving a reason is ordinary, and `POST /cancel` with no body at all
 * should mean the same as `{}` rather than 400.
 *
 * A body that is present but malformed is still a 400. The only thing treated
 * as "nothing was sent" is nothing.
 */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const raw = (await request.text()).trim();

  if (raw === "") {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("Malformed request body.");
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function jsonError(
  error: string,
  status: number,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Converts a thrown error into a response. Unrecognised errors are logged
 * server-side and reduced to a generic message — PRD §9 forbids leaking
 * internals to the client.
 */
export function toErrorResponse(
  error: unknown,
  context: string,
): NextResponse<ApiResponse<never>> {
  if (error instanceof UnauthenticatedError) {
    return jsonError("You are not signed in.", 401);
  }

  // Stage 3, the first Owner API routes. Mirrors what /owner/dashboard does:
  // no session at all is a 401, but a signed-in caller who is not an Owner gets
  // 404 — never 403, which would confirm the platform surface exists and that
  // they merely lack the role.
  if (error instanceof PlatformAuthorizationError) {
    if (error.reason === "no-session") {
      return jsonError("You are not signed in.", 401);
    }
    return jsonError("Not found.", 404);
  }

  if (error instanceof PermissionError) {
    return jsonError("You do not have permission to do that.", 403);
  }

  // Stage 8. Also a 403 — the caller genuinely may not do this — but with its
  // own message, because "you do not have permission" would send someone to
  // their admin when the answer is that their organisation's plan, or a
  // platform-wide switch, is what stopped them. The message names the layer at
  // the granularity that tells them who to ask, and no finer.
  if (error instanceof FeatureError) {
    return jsonError(error.message, 403);
  }

  if (error instanceof ScopeError) {
    // 404, not 403: telling a caller "that clinic exists but isn't yours" is
    // itself a cross-tenant disclosure.
    return jsonError("Not found.", 404);
  }

  if (error instanceof BadRequestError) {
    return jsonError(error.message, 400);
  }

  // Stage 4. The message is fixed and subject-free by construction (see
  // RATE_LIMITED_MESSAGE), so a 429 tells a caller that THEY are throttled and
  // nothing about whose account they were guessing at. `retryAfterMs` is
  // deliberately not echoed: on the unauthenticated login-code endpoint a
  // precise window varies with how far through its allowance one address is,
  // which is the account-existence signal that endpoint exists to hide.
  if (error instanceof RateLimitError) {
    return jsonError(error.message, 429);
  }

  if (error instanceof ConflictError) {
    // Written for the user, so passed through rather than genericised.
    return jsonError(error.message, 409);
  }

  if (error instanceof ZodError) {
    return jsonError(
      error.issues[0]?.message ?? "Check the submitted values.",
      400,
    );
  }

  if (error instanceof MediaConfigurationError) {
    console.error(`${context} failed due to media configuration:`, error.message);
    return jsonError("Media service is temporarily unavailable.", 503);
  }

  if (error instanceof MediaFileMissingError) {
    return jsonError("The requested media file could not be found.", 404);
  }

  if (error instanceof MediaAccessError || error instanceof InvalidTokenError) {
    return jsonError("You do not have access to this media.", 403);
  }

  console.error(`${context} failed`, error);
  return jsonError("Something went wrong. Try again.", 500);
}
