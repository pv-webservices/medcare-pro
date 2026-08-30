import { Response as createPlivoResponse } from "plivo";

export const STAGE_1_GREETING = "Welcome to MedCare Pro telephony testing.";

/** Builds the complete Stage 1 call flow. End-of-XML completes the call normally. */
export function buildStage1AnswerXml(): string {
  const response = createPlivoResponse();
  response.addSpeak(STAGE_1_GREETING, {});
  return response.toXML();
}
