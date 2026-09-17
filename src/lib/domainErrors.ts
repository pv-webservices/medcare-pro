/**
 * HTTP-agnostic domain errors shared by request handlers and background jobs.
 * Keep this module dependency-free so cron bundles do not pull in Next.js.
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
