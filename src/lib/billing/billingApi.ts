import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import type { NextResponse } from "next/server";

function privateResponse<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
export function billingJsonOk<T>(data: T, status = 200) {
  return privateResponse(jsonOk(data, status));
}
export function billingErrorResponse(error: unknown, context: string) {
  return privateResponse(toErrorResponse(error, context));
}
