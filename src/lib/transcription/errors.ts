export type TranscriptionFailureCode = "AUTH" | "QUOTA" | "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "UNSUPPORTED_AUDIO" | "INVALID_RESPONSE" | "CONFIGURATION" | "SOURCE_MISSING" | "PROVIDER_FAILURE" | "CONSENT_INVALID";

/** Never attach the provider body, credentials, signed URL, or transcript. */
export class TranscriptionFailure extends Error {
  constructor(readonly code: TranscriptionFailureCode, readonly retryable = false) {
    super(code);
    this.name = "TranscriptionFailure";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static [Symbol.hasInstance](instance: unknown): boolean {
    return (
      typeof instance === "object" &&
      instance !== null &&
      (instance as Error).name === "TranscriptionFailure" &&
      "code" in instance
    );
  }
}
