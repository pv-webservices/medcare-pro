import { jsonError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { friendlyBillingError } from "./billingMessages";
import type { NextResponse } from "next/server";

function privateResponse<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
export function billingJsonOk<T>(data: T, status = 200) {
  return privateResponse(jsonOk(data, status));
}
/** Validation and money-rule failures are reworded for people (./billingMessages); the rest keep their handling. */
export function billingErrorResponse(error: unknown, context: string) {
  const friendly = friendlyBillingError(error);
  return privateResponse(friendly ? jsonError(friendly, 400) : toErrorResponse(error, context));
}
