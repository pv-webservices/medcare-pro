export class ClinicLimitReachedError extends Error {
  readonly code = "CLINIC_LIMIT_REACHED" as const;

  constructor() {
    super("Your organization has reached its clinic limit.");
    this.name = "ClinicLimitReachedError";
  }
}

export class ClinicCapacityConfigurationError extends Error {
  readonly code = "CLINIC_CAPACITY_NOT_CONFIGURED" as const;

  constructor() {
    super("Clinic capacity is not configured for this organization. Contact MEDCARE PRO.");
    this.name = "ClinicCapacityConfigurationError";
  }
}

