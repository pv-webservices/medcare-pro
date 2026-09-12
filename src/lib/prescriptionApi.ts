import { ZodError } from "zod";
import {
  BadRequestError,
  ConflictError,
  toErrorResponse,
  jsonOk,
} from "@/lib/apiHandler";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { UnauthenticatedError } from "@/lib/session";

/** Prisma errors can contain the submitted clinical payload. Preserve shared
 * public error semantics, but sanitize unexpected errors before generic logging.
 */
export function prescriptionErrorResponse(error: unknown, context: string) {
  const known =
    error instanceof ZodError ||
    error instanceof BadRequestError ||
    error instanceof ConflictError ||
    error instanceof PermissionError ||
    error instanceof ScopeError ||
    error instanceof FeatureError ||
    error instanceof UnauthenticatedError;
  return toErrorResponse(
    known
      ? error
      : new Error("Clinical operation failed; database payload withheld."),
    context,
  );
}

export function prescriptionJsonOk<T>(data: T) {
  const response = jsonOk(data);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
