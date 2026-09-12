import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../../src/lib/prisma";
import type { createPatientPortalFixture } from "../../scripts/patient-portal-test-fixture";
import { PRESCRIPTION_TEST_PASSWORD } from "../../scripts/prescription-test-fixture";
const origin = "http://127.0.0.1:33322";
const database = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.startsWith("/medcare_ep_portal_")
)
  throw new Error("Requires a disposable local patient portal database.");
let f: Awaited<ReturnType<typeof createPatientPortalFixture>>;
test.beforeEach(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "patient-portal:" } } });
  f = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/create-patient-portal-e2e.mts",
      ],
      { env: process.env, encoding: "utf8" },
    ),
  );
});
test.afterAll(async () => prisma.$disconnect());
async function signIn(page: Page, email: string) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const r = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password: PRESCRIPTION_TEST_PASSWORD,
      callbackUrl: `${origin}/dashboard`,
    },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(r.ok()).toBe(true);
}
async function outbox(type: string) {
  const path = resolve(
    process.env.PATIENT_PORTAL_TEST_OUTBOX ??
      "C:/Users/hp/.codex/visualizations/2026/09/12/01a096d9-a9e5-7331-a731-25e4a20362e1/portal-outbox",
    "outbox.jsonl",
  );
  let entry: { activationUrl?: string; code?: string } | undefined;
  await expect
    .poll(async () => {
      try {
        const entries = (await readFile(path, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        entry = entries
          .filter((e) => e.type === type && e.mobileE164 === `+91${f.number}`)
          .at(-1);
        return !!entry;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return entry!;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test("staff activation, patient records, IDOR, print, revocation and logout", async ({
  page,
  browser,
}, info) => {
  await signIn(page, f.receptionist.email);
  await page.goto(`/registration/${f.visitA.id}`);
  await expect(
    page.getByRole("heading", { name: "Patient Portal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enable Patient Portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm patient identity" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Identity verified — enable portal" })
    .click();
  await expect(page.getByText(/PENDING ACTIVATION/)).toBeVisible();
  const activation = await outbox("activation");
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  const patient = await context.newPage();
  await patient.goto(activation.activationUrl!);
  await expect(
    patient.getByRole("heading", { name: "Activate your portal" }),
  ).toBeVisible();
  await patient.getByRole("button", { name: "Send verification code" }).click();
  await expect(patient.getByLabel("Verification code")).toBeVisible();
  const challenge = await outbox("code");
  await patient.getByLabel("Verification code").fill(challenge.code!);
  await patient.getByRole("button", { name: "Verify and continue" }).click();
  await expect(patient).toHaveURL(`${origin}/patient`);
  await expect(
    patient.getByRole("heading", { name: `Welcome, ${f.patient.name}` }),
  ).toBeVisible();
  await noOverflow(patient);
  const knownMobile = await patient.request.post(
    "/api/patient-portal/auth/login/request",
    { headers: { origin }, data: { mobile: f.number } },
  );
  const unknownMobile = await patient.request.post(
    "/api/patient-portal/auth/login/request",
    { headers: { origin }, data: { mobile: `7${f.number.slice(1)}` } },
  );
  expect(knownMobile.status()).toBe(200);
  expect(unknownMobile.status()).toBe(200);
  expect(await knownMobile.json()).toEqual(await unknownMobile.json());
  await patient.screenshot({
    path: info.outputPath("patient-home.png"),
    fullPage: true,
  });
  for (const path of ["visits", "appointments", "profile", "prescriptions"]) {
    await patient.goto(`/patient/${path}`);
    await noOverflow(patient);
  }
  await expect(patient.getByText(f.issued.prescriptionNumber)).toBeVisible();
  for (const id of [f.issued.id, f.superseded.id, f.cancelled.id]) {
    await patient.goto(`/patient/prescriptions/${id}`);
    await noOverflow(patient);
  }
  await expect(
    patient.getByText(
      "This prescription is no longer valid. Retained as a historical record.",
    ),
  ).toBeVisible();
  for (const [kind, id] of [
    ["visits", f.visitBRow.id],
    ["visits", f.visitCRow.id],
    ["appointments", f.appointmentB.id],
    ["appointments", f.appointmentC.id],
    ["appointments", f.unlinked.id],
    ["prescriptions", f.rxB.id],
    ["prescriptions", f.rxC.id],
    ["prescriptions", f.draft.id],
  ]) {
    const r = await patient.request.get(`/api/patient-portal/me/${kind}/${id}`);
    expect(r.status()).toBe(404);
  }
  for (const path of [
    `/patient/prescriptions/${f.rxB.id}`,
    `/patient/prescriptions/${f.rxB.id}/print`,
    `/patient/prescriptions/${f.rxC.id}/print`,
    `/patient/prescriptions/${f.draft.id}/print`,
  ])
    expect((await patient.goto(path))?.status()).toBe(404);
  for (const [field, id] of [
    ["patientId", f.patientB.id],
    ["tenantId", f.foreignTenant.id],
    ["clinicId", f.foreignClinic.id],
  ]) {
    expect(
      (
        await patient.request.get(`/api/patient-portal/me?${field}=${id}`)
      ).status(),
    ).toBe(400);
    expect(
      (
        await patient.request.post("/api/patient-portal/auth/login/request", {
          headers: { origin },
          data: { mobile: f.number, [field]: id },
        })
      ).status(),
    ).toBe(400);
  }
  const spoof = await patient.request.get("/api/patient-portal/me", {
    headers: {
      "x-patient-id": f.patientB.id,
      "x-tenant-id": f.foreignTenant.id,
      cookie:
        (await context.cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; ") +
        `; patientId=${f.patientB.id}; tenantId=${f.foreignTenant.id}; clinicId=${f.foreignClinic.id}`,
    },
  });
  expect((await spoof.json()).data.patientCode).toBe(f.patient.patientCode);
  for (const path of [
    "/api/prescriptions",
    "/api/registrations",
    "/api/patients",
    "/api/features",
  ])
    expect((await patient.request.get(path)).status()).toBe(401);
  expect((await patient.goto("/dashboard"))?.url()).toContain("/login");
  await patient.goto(`/patient/prescriptions/${f.issued.id}/print`);
  await patient.evaluate(() => {
    (window as unknown as { portalPrintCalled: boolean }).portalPrintCalled =
      false;
    window.print = () => {
      (window as unknown as { portalPrintCalled: boolean }).portalPrintCalled =
        true;
    };
  });
  await patient.getByRole("button", { name: "Print / Save as PDF" }).click();
  expect(
    await patient.evaluate(
      () =>
        (window as unknown as { portalPrintCalled: boolean }).portalPrintCalled,
    ),
  ).toBe(true);
  await patient.emulateMedia({ media: "print" });
  await expect(
    patient.getByRole("navigation", { name: "Patient navigation" }),
  ).toBeHidden();
  await patient.screenshot({
    path: info.outputPath("patient-prescription-print.png"),
    fullPage: true,
  });
  await patient.emulateMedia({ media: "screen" });
  expect(
    (
      await patient.request.post("/api/patient-portal/auth/logout", {
        headers: { origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  await patient.goto("/patient");
  await patient.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(patient).toHaveURL(`${origin}/patient/login`);
  expect((await patient.request.get("/api/patient-portal/me")).status()).toBe(
    401,
  );
  await prisma.patientPortalChallenge.updateMany({
    where: { mobileE164: `+91${f.number}` },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  // Activation and login share the request cooldown: clear only the synthetic
  // rate bucket via the database, never a production/debug HTTP endpoint.
  await prisma.rateLimitBucket.deleteMany({
    where: { key: { startsWith: "patient-portal:cooldown:" } },
  });
  await patient.getByLabel("Mobile number").fill(f.number);
  await patient.getByRole("button", { name: "Send verification code" }).click();
  await expect(patient.getByLabel("Verification code")).toBeVisible();
  const loginCode = await outbox("code");
  await patient.getByLabel("Verification code").fill(loginCode.code!);
  await patient.getByRole("button", { name: "Verify and continue" }).click();
  await expect(patient).toHaveURL(`${origin}/patient`);
  await page.reload();
  await expect(page.getByText(/ACTIVE · Login mobile/)).toBeVisible();
  await page.getByRole("button", { name: "Revoke Access" }).click();
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(page.getByText(/REVOKED · Login mobile/)).toBeVisible();
  expect((await patient.request.get("/api/patient-portal/me")).status()).toBe(
    401,
  );
  await patient.reload();
  await expect(patient).toHaveURL(`${origin}/patient/login`);
  await context.close();
});
test("authentication domains, enumeration, origin and staff permission remain independent", async ({
  page,
  browser,
}) => {
  await signIn(page, f.doctorUser.email);
  expect((await page.request.get("/api/patient-portal/me")).status()).toBe(401);
  await page.goto("/patient");
  await expect(page).toHaveURL(`${origin}/patient/login`);
  expect(
    (
      await page.request.post(`/api/patients/${f.patient.id}/portal/activate`, {
        headers: { origin },
        data: { identityVerified: true },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(
        `/api/patients/${f.patientC.id}/portal/activate`,
        { headers: { origin }, data: { identityVerified: true } },
      )
    ).status(),
  ).toBe(404);
  const anonymous = await browser.newContext();
  const request = anonymous.request;
  const known = await request.post("/api/patient-portal/auth/login/request", {
    headers: { origin },
    data: { mobile: f.number },
  });
  const unknown = await request.post("/api/patient-portal/auth/login/request", {
    headers: { origin },
    data: { mobile: `6${f.number.slice(1)}` },
  });
  expect(known.status()).toBe(200);
  expect(unknown.status()).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  expect(
    (
      await request.post("/api/patient-portal/auth/login/request", {
        data: { mobile: "9999999999" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/patient-portal/auth/login/request", {
        headers: { origin },
        data: { mobile: `6${f.number.slice(1)}` },
      })
    ).status(),
  ).toBe(429);
  await anonymous.close();
});
