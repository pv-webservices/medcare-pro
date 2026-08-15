import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * One-time admin provisioning — PRD §5 (MVP has no self-signup; a single admin
 * is provisioned per clinic deployment).
 *
 * Run once per clinic, after `prisma migrate deploy`:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx prisma db seed
 *
 * Idempotent: if an admin with that email already exists the script exits
 * without touching it. It will never silently reset a live admin's password.
 */

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

const prisma = new PrismaClient();

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env before seeding.`);
  }
  return value;
}

async function main(): Promise<void> {
  const email = readRequiredEnv("ADMIN_EMAIL").toLowerCase();
  const password = readRequiredEnv("ADMIN_PASSWORD");

  if (!email.includes("@")) {
    throw new Error("ADMIN_EMAIL is not a valid email address.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.info(`Admin ${email} already exists — nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
    },
  });

  console.info(`Created admin ${email}.`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
