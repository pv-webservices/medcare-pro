import { z } from "zod";

export const TELEPHONY_TEST_CALL_STATUSES = [
  "REQUESTED",
  "RINGING",
  "ANSWERED",
  "COMPLETED",
  "FAILED",
] as const;
export type TelephonyTestCallStatus =
  (typeof TELEPHONY_TEST_CALL_STATUSES)[number];

export const startTelephonyTestCallSchema = z.object({}).strict();

export interface TelephonyTestCallView {
  id: string;
  status: TelephonyTestCallStatus;
  destinationLabel: string;
  createdAt: string;
  answeredAt: string | null;
  completedAt: string | null;
  message: string;
}

export interface TelephonyTestCallPanelView {
  available: boolean;
  destinationLabel: string | null;
  unavailableReason: string | null;
  latestAttempt: TelephonyTestCallView | null;
}

export function isActiveTelephonyTestCallStatus(
  status: TelephonyTestCallStatus,
): boolean {
  return status === "REQUESTED" || status === "RINGING" || status === "ANSWERED";
}

export function telephonyTestCallMessage(
  status: TelephonyTestCallStatus,
): string {
  switch (status) {
    case "REQUESTED":
      return "Starting the controlled test call.";
    case "RINGING":
      return "The configured QA number is ringing.";
    case "ANSWERED":
      return "The test call was answered and the phone menu is playing.";
    case "COMPLETED":
      return "The controlled phone menu test completed.";
    case "FAILED":
      return "The test call could not be completed. Try again later.";
  }
}
