import { notImplemented } from "@/lib/utils";

// PRD §9 — Patient CRUD (FR-2.1 … FR-2.4).
// TODO(patients stage): list/search, create, update, delete. Requires an
// authenticated session (PRD §10 Security).

export async function GET() {
  return notImplemented("GET /api/patients");
}

export async function POST() {
  return notImplemented("POST /api/patients");
}

export async function PUT() {
  return notImplemented("PUT /api/patients");
}

export async function DELETE() {
  return notImplemented("DELETE /api/patients");
}
