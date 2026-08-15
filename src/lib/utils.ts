import { NextResponse } from "next/server";

/**
 * Standard API response envelope used by every route under `src/app/api`.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Scaffold placeholder: every API route returns this until its stage is built.
 * Delete the call site as each route gets a real implementation.
 */
export function notImplemented(route: string): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    { success: false, error: `Not implemented: ${route}` },
    { status: 501 },
  );
}
