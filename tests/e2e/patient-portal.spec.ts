import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../../src/lib/prisma";
import { hashPortalToken } from "../../src/lib/patientPortalSecurity";
import type { createPatientPortalFixture } from "../../scripts/patient-portal-test-fixture";
import { PRESCRIPTION_TEST_PASSWORD } from "../../scripts/prescription-test-fixture";
const origin = "http://127.0.0.1:33322";
let f: Awaited<ReturnType<typeof createPatientPortalFixture>>;
const password = "synthetic patient passphrase";
const replacement = "synthetic replacement passphrase";
test.beforeEach(async () => {
  await prisma.rateLimitBucket.deleteMany({
    where: { key: { startsWith: "patient-portal:" } },
  });
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
async function signIn(page: Page) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const r = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: f.receptionist.email,
      password: PRESCRIPTION_TEST_PASSWORD,
      callbackUrl: `${origin}/dashboard`,
    },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(r.ok()).toBe(true);
}
async function outbox(email: string, purpose: string) {
  let url = "";
  await expect
    .poll(async () => {
      try {
        const entries = (
          await readFile(
            resolve(
              process.env.PATIENT_PORTAL_TEST_OUTBOX ??
                "test-results/patient-portal-outbox",
              "outbox.jsonl",
            ),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        url =
          entries.filter((e) => e.to === email && e.purpose === purpose).at(-1)
            ?.url ?? "";
        return !!url;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return url;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function patientLogin(page: Page, passwordValue: string) {
  await page.goto(`/patient/login?org=${f.tenant.slug}`);
  await noOverflow(page);
  await expect(page.getByLabel("Organization", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Clinic Access Code", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: f.tenant.businessName }),
  ).toBeVisible();
  await page
    .getByLabel("Patient ID", { exact: true })
    .fill(f.patient.patientCode);
  await page.getByLabel("Password", { exact: true }).fill(passwordValue);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("QR, password, verified email recovery, clinical IDOR, print and immediate revocation", async ({
  page,
  browser,
}, info) => {
  await signIn(page);
  await page.goto(`/registration/${f.visitA.id}`);
  await page
    .getByRole("button", { name: "Enable Patient Portal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirm patient identity" }),
  ).toBeVisible();
  const activationResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/patients/${f.patient.id}/portal/activate`) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Identity verified — enable portal" })
    .click();
  const activation = (await (await activationResponse).json()).data;
  await expect(
    page.getByRole("heading", {
      name: "Patient Portal Activation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".portal-activation-card svg")).toBeVisible();
  expect(activation.activationUrl).toMatch(
    /^http:\/\/127.0.0.1:33322\/patient\/activate\/[\w-]{43}$/,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByText("PENDING ACTIVATION", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".portal-activation-card svg")).toHaveCount(0);
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  const patient = await context.newPage();
  await patient.goto(`/patient/login?org=${f.tenant.slug}`);
  await patient.screenshot({
    path: info.outputPath("login.png"),
    caret: "initial",
    fullPage: true,
  });
  const email = `patient-${f.patient.id}@example.test`;
  await patient.goto(activation.activationUrl);
  await patient.getByLabel("Create password", { exact: true }).fill(password);
  await patient.getByLabel("Confirm password", { exact: true }).fill(password);
  await patient
    .getByLabel("Recovery email (recommended)", { exact: true })
    .fill(email);
  await noOverflow(patient);
  await patient
    .getByRole("button", { name: "Activate Patient Portal", exact: true })
    .click();
  await expect(patient).toHaveURL(/\/patient\/profile/);
  await expect(patient.getByText(/Verification pending/)).toBeVisible();
  await patient.screenshot({
    path: info.outputPath("security.png"),
    caret: "initial",
    fullPage: true,
  });
  await noOverflow(patient);
  const verifyUrl = await outbox(email, "VERIFY_RECOVERY_EMAIL");
  const raw = new URL(verifyUrl).searchParams.get("token")!;
  await patient.goto(verifyUrl);
  expect(
    (
      await prisma.patientPortalSecurityToken.findUniqueOrThrow({
        where: {
          tokenHash: hashPortalToken(raw),
        },
      })
    ).consumedAt,
  ).toBeNull();
  await patient
    .getByRole("button", { name: "Verify recovery email", exact: true })
    .click();
  await expect(
    patient.getByText("Recovery email verified.", { exact: true }),
  ).toBeVisible();
  // Follow "Back to sign in" to verify organization preservation
  await patient.getByRole("link", { name: "Back to sign in" }).click();
  await expect(patient).toHaveURL(
    new RegExp(`/patient/login\\?org=${f.tenant.slug}`),
  );
  await expect(patient.getByLabel("Organization", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    patient.getByLabel("Clinic Access Code", { exact: true }),
  ).toHaveCount(0);
  await expect(
    patient.getByRole("heading", { name: f.tenant.businessName }),
  ).toBeVisible();
  await patient.goto("/patient/profile");
  await expect(patient.getByText(/· Verified/)).toBeVisible();
  await patient
    .getByRole("button", { name: /Sign out|Log out|Logout/i })
    .click();
  await patientLogin(patient, password);
  await expect(patient).toHaveURL(`${origin}/patient`);
  await noOverflow(patient);
  for (const path of ["visits", "appointments", "prescriptions"]) {
    await patient.goto(`/patient/${path}`);
    await expect(patient.locator("h1")).toBeVisible();
    await noOverflow(patient);
  }
  for (const [kind, ids] of [
    ["visits", [f.visitBRow.id, f.visitCRow.id]],
    ["appointments", [f.appointmentB.id, f.appointmentC.id]],
    ["prescriptions", [f.rxB.id, f.rxC.id, f.draft.id]],
  ] as const)
    for (const id of ids)
      expect(
        (
          await patient.request.get(`/api/patient-portal/me/${kind}/${id}`)
        ).status(),
      ).toBe(404);
  await patient.goto(`/patient/prescriptions/${f.issued.id}/print`);
  await expect(patient.locator("h1")).toBeVisible();
  await noOverflow(patient);
  const staffMe = await page.request.get("/api/patient-portal/me");
  expect(staffMe.status()).toBe(401);
  const staffApi = await patient.request.get("/api/patients");
  expect(staffApi.status()).toBe(401);
  const foreignPrint = await patient.request.get(
    `/patient/prescriptions/${f.rxB.id}/print`,
  );
  expect(foreignPrint.status()).toBe(404);
  // Keep this context's session active while a separate browser redeems reset.
  const resetContext = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`/patient/forgot-password?org=${f.tenant.slug}`);
  await expect(
    resetPage.getByLabel("Organization", { exact: true }),
  ).toHaveCount(0);
  await expect(
    resetPage.getByLabel("Clinic Access Code", { exact: true }),
  ).toHaveCount(0);
  await resetPage
    .getByLabel("Patient ID", { exact: true })
    .fill(f.patient.patientCode);
  await resetPage.getByLabel("Recovery email", { exact: true }).fill(email);
  await noOverflow(resetPage);
  await resetPage.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    resetPage.getByText(
      /If the details match an active Patient Portal account/,
    ),
  ).toBeVisible();
  await resetPage.goto(await outbox(email, "PASSWORD_RESET"));
  await resetPage
    .getByLabel("Create password", { exact: true })
    .fill(replacement);
  await resetPage
    .getByLabel("Confirm password", { exact: true })
    .fill(replacement);
  await noOverflow(resetPage);
  await resetPage.getByRole("button", { name: "Update password" }).click();
  await expect(resetPage).toHaveURL(
    new RegExp(`/patient/login\\?org=${f.tenant.slug}&reset=complete`),
  );
  await expect(
    resetPage.getByLabel("Organization", { exact: true }),
  ).toHaveCount(0);
  await expect(
    resetPage.getByLabel("Clinic Access Code", { exact: true }),
  ).toHaveCount(0);
  await expect(
    resetPage.getByText(
      "Password updated. Sign in with your new password.",
    ),
  ).toBeVisible();
  expect((await patient.request.get("/api/patient-portal/me")).status()).toBe(
    401,
  );

  // Generic /patient/login without ?org
  await resetPage.goto("/patient/login");
  await expect(
    resetPage.getByLabel("Clinic Access Code", { exact: true }),
  ).toBeVisible();
  await expect(
    resetPage.getByText(
      /Find this code on your clinic's Patient Portal link, receipt or prescription/,
    ),
  ).toBeVisible();
  // Format guidance when entering name with spaces instead of slug
  await resetPage
    .getByLabel("Clinic Access Code", { exact: true })
    .fill("Sharma Clinic");
  await resetPage
    .getByLabel("Patient ID", { exact: true })
    .fill(f.patient.patientCode);
  await resetPage.getByLabel("Password", { exact: true }).fill(replacement);
  await resetPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    resetPage.getByText(
      "Enter your Clinic Access Code, for example sharma-clinic.",
    ),
  ).toBeVisible();
  // Valid unknown slug returns generic failure
  await resetPage
    .getByLabel("Clinic Access Code", { exact: true })
    .fill("valid-unknown-slug");
  await resetPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    resetPage.getByText("Invalid sign-in details.", { exact: true }),
  ).toBeVisible();

  await patientLogin(resetPage, password);
  await expect(
    resetPage.getByText("Invalid sign-in details.", { exact: true }),
  ).toBeVisible();
  await patientLogin(resetPage, replacement);
  await expect(resetPage).toHaveURL(`${origin}/patient`);
  await page.goto(`/registration/${f.visitA.id}`);
  await page
    .getByRole("button", { name: "Revoke Access", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(page.getByText("REVOKED", { exact: true })).toBeVisible();
  expect((await resetPage.request.get("/api/patient-portal/me")).status()).toBe(
    401,
  );
  await context.close();
  await resetContext.close();
});
