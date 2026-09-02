export type PhoneDiagnosticsHealthStatus =
  | "healthy"
  | "attention"
  | "no-data";

export type ProductionCallDisplayStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "INCOMPLETE";

export interface ProductionCallDiagnosticView {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly callerLabel: string;
  readonly status: ProductionCallDisplayStatus;
  readonly initialRoute: "RECEPTION" | "IVR" | null;
  readonly highlights: readonly string[];
}

export interface PhoneDiagnosticsView {
  readonly window: { readonly hours: 24 };
  readonly timezone: string;
  readonly health: {
    readonly status: PhoneDiagnosticsHealthStatus;
    readonly recentCalls: number;
    readonly incompleteCalls: number;
    readonly receptionFailures: number;
    readonly urgentTransferFailures: number;
  };
  readonly recentCalls: readonly ProductionCallDiagnosticView[];
}
