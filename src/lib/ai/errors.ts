export type AiErrorCode =
  | "DISABLED"
  | "TIMEOUT"
  | "AUTH"
  | "QUOTA"
  | "MODEL"
  | "NETWORK"
  | "INVALID_OUTPUT"
  | "RATE_LIMIT";
// Never attach a provider error, payload or cause: these may contain PHI/secrets.
export class AiError extends Error {
  constructor(public readonly code: AiErrorCode) {
    super(
      "AI writing assistance is temporarily unavailable. Your clinical note has not been changed.",
    );
    this.name = "AiError";
  }
}
