import type { AiErrorCode } from "@/lib/ai/errors";

const AI_CODES = new Set<AiErrorCode>([
  "DISABLED",
  "TIMEOUT",
  "AUTH",
  "QUOTA",
  "MODEL",
  "NETWORK",
  "INVALID_OUTPUT",
  "RATE_LIMIT",
]);
const RUN_FAILURES = new Set(["STALE", "NOT_AUTHORIZED", "DISABLED", "LEASE_LOST"]);

/**
 * Bounded failure category for a fact extraction run. Duck-typed on `name`
 * because the same error class can be loaded twice (bundles, test runners),
 * but only known codes are accepted: any other error, including database and
 * socket errors that also carry a `code`, is recorded as FAILED.
 */
export function factFailureCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "FAILED";
  const { name } = error as { name?: unknown };
  const failure = (error as { failure?: unknown }).failure;
  const code = (error as { code?: unknown }).code;
  if (name === "FactRunFailure" && typeof failure === "string" && RUN_FAILURES.has(failure))
    return failure;
  if (name === "AiError" && typeof code === "string" && AI_CODES.has(code as AiErrorCode))
    return code;
  return "FAILED";
}
