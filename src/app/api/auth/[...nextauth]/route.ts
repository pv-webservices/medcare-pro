import { notImplemented } from "@/lib/utils";

// PRD §9 — Auth.js handler (FR-1.1, FR-1.2).
// TODO(auth stage): replace with the NextAuth handler exported from `@/lib/auth`.

export async function GET() {
  return notImplemented("GET /api/auth/[...nextauth]");
}

export async function POST() {
  return notImplemented("POST /api/auth/[...nextauth]");
}
