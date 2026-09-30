import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertBillingTestDatabase, BILLING_TEST_PASSWORD, createBillingFixture } from "../../scripts/billing-test-fixture";

// Post-launch billing usability: empty states, friendly messages, the full
// Review preview, "+ New bill" and the menu order. Runs at desktop and 375px
// (playwright.billing.config.ts), each on its own synthetic account.
assertBillingTestDatabase();
const db = new PrismaClient();
let f: Awaited<ReturnType<typeof createBillingFixture>>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  f = await createBillingFixture(db);
  // Start with an empty price list: the fixture's one service is unused so far.
  await db.serviceItem.delete({ where: { id: f.service.id } });
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function signIn(page: Page, email: string) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password: BILLING_TEST_PASSWORD, callbackUrl: "http://127.0.0.1:33313/dashboard" },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).url).not.toContain("error=");
}
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
/** A dialog on a phone is a scrolling bottom sheet over a fixed overlay: capture the viewport, not the element. */
async function shootDialog(page: Page, dialog: ReturnType<Page["getByRole"]>, path: string, isMobile: boolean) {
  if (isMobile) await page.screenshot({ path });
  else await dialog.screenshot({ path });
}
async function patientCode(registrationId: string) {
  const visit = await db.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { patient: true } });
  return { code: visit.patient.patientCode, name: visit.patient.name };
}
const RAW_WORDING = /non-negative decimal|Expected|Invalid|Too small|Too big|must match pattern/;

test("an empty billing list says how to start, filters offer a reset, and Billing follows Registrations", async ({ page, isMobile }) => {
  await signIn(page, f.owner.email);
  await page.goto("/billing");
  await expect(page.getByText("No bills yet. Start one with + New bill, or open a visit in Registrations and click Create bill.")).toBeVisible();
  await page.goto("/billing?status=DRAFT");
  await expect(page.getByText("No bills match these filters.")).toBeVisible();
  await expect(page.getByText("No bills yet.")).toHaveCount(0);
  await page.getByText("No bills match these filters.").getByRole("link", { name: "Reset filters" }).click();
  await expect(page).toHaveURL(/\/billing$/);

  if (isMobile) await page.getByRole("button", { name: "Open navigation menu" }).click();
  const labels = await page.locator('nav[aria-label="Main"]:visible a[href]').allTextContents();
  const tabs = labels.map((label) => label.trim()).filter((label) => ["Dashboard", "Registrations", "Billing"].some((tab) => label.startsWith(tab)));
  expect(tabs.map((label) => label.replace(/\d+$/, "").trim())).toEqual(["Dashboard", "Registrations", "Billing"]);
});

test("empty price list → add a service in Settings → the picker lists it; friendly errors; review and issue", async ({ page, isMobile }, testInfo) => {
  const visit = await f.visit();
  const patient = await patientCode(visit.id);
  await signIn(page, f.owner.email);
  await page.goto(`/registration/${visit.id}/bill`);
  await page.getByRole("button", { name: "Create bill", exact: true }).click();
  const empty = page.getByRole("note").filter({ hasText: "No services yet." });
  await expect(empty).toHaveText("No services yet. Add your price list in Settings → Billing, or use Add custom line.");
  await expect(page.locator("#bill-service")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("empty-service-state.png"), fullPage: true });

  // Settings → Billing: add a service, then come back to the bill.
  await empty.getByRole("link", { name: "Settings → Billing" }).click();
  await expect(page).toHaveURL(/\/settings\/billing$/);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.locator("#service-name").fill("Synthetic ultrasound");
  await form.locator("#service-price").fill("750");
  await form.getByRole("button", { name: "Save service", exact: true }).click();
  await expect(form).toBeHidden();
  await page.goto(`/registration/${visit.id}/bill`);
  await expect(page.locator("#bill-service option")).toContainText(["Select service", "Synthetic ultrasound — ₹750.00"]);
  await expect(page.getByRole("button", { name: "Add service", exact: true })).toBeDisabled();
  await page.locator("#bill-service").selectOption({ label: "Synthetic ultrasound — ₹750.00" });
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(page.locator("#line-1-description")).toHaveValue("Synthetic ultrasound");
  await expect(page.locator("#line-1-category")).toHaveValue("CONSULTATION");

  // Discount (%): Apply waits for input; bad input gets one plain sentence.
  const lineOne = page.getByRole("group", { name: "Line 1" });
  await expect(lineOne.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  for (const bad of ["abc", "150", "12.345"]) {
    await page.locator("#line-0-percent").fill(bad);
    await lineOne.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(lineOne.getByText("Enter a discount between 0 and 100, e.g. 10")).toBeVisible();
  }
  await page.locator("#line-0-price").fill("abc");
  await expect(lineOne.getByText("Enter a price like 500 or 499.50")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(RAW_WORDING);
  await page.locator("#line-0-price").fill("300.00");
  await page.locator("#line-0-percent").fill("10%");
  await lineOne.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#line-0-discount")).toHaveValue("30.00");
  await expect(page.getByText("Draft · not saved yet")).toBeVisible();

  // Review saves first, then shows the whole document the bill will become.
  await page.getByRole("button", { name: "Review bill", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review bill" });
  await expect(review).toBeVisible();
  await expect(page.getByText("Draft · saved")).toBeVisible();
  await expect(review.getByRole("note")).toContainText(/Once issued, this bill gets a number \(e\.g\. INV-\d{4}-000xx\) and can't be edited\. Mistakes are fixed by cancelling and creating a replacement\./);
  const preview = review.locator(".invoice-document");
  await expect(preview).toContainText("DRAFT — not yet issued");
  await expect(preview).toContainText("Number assigned on issue");
  await expect(preview.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
  for (const text of [f.clinic.name, `${patient.name} · ${patient.code}`, "9333333333", "Dr. Synthetic Billing", "Synthetic ultrasound", "Rupees One Thousand Twenty Only"]) {
    await expect(preview).toContainText(text);
  }
  await expect(review).toContainText(/Grand total\s*₹1,020\.00/);
  await expectNoHorizontalScroll(page);
  await shootDialog(page, review, testInfo.outputPath("review-preview.png"), isMobile);
  await review.getByRole("button", { name: "Back to edit", exact: true }).click();
  await expect(review).toBeHidden();

  await page.getByRole("button", { name: "Review bill", exact: true }).click();
  await review.getByRole("button", { name: "Issue bill", exact: true }).click();
  await expect(page).toHaveURL(/\/billing\/[^/]+$/);
  const notice = page.getByRole("status").filter({ hasText: "issued." });
  await expect(notice).toHaveText(/^Bill INV-\d{4}-\d{5} issued\.$/);
  await expect(page.getByRole("heading", { level: 1, name: /^INV-\d{4}-\d{5} · Issued$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "issued." })).toHaveCount(0);
});

test("+ New bill finds a visit by patient code and opens the right page for its bill state", async ({ page, isMobile }, testInfo) => {
  const visit = await f.visit();
  const patient = await patientCode(visit.id);
  await signIn(page, f.owner.email);

  async function pick(search: string) {
    await page.goto("/billing");
    await page.getByRole("button", { name: "+ New bill", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New bill" });
    await dialog.getByLabel("Patient name, mobile or patient code").fill(search);
    const result = dialog.getByRole("link").filter({ hasText: patient.code });
    await expect(result).toHaveCount(1);
    return { dialog, result };
  }

  const first = await pick(patient.code);
  await expect(first.result).toContainText(patient.name);
  await expect(first.result).toContainText("Dr. Synthetic Billing");
  await expect(first.result).toContainText("Not billed");
  await expectNoHorizontalScroll(page);
  await shootDialog(page, first.dialog, testInfo.outputPath("new-bill-picker.png"), isMobile);
  await first.result.click();
  await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/bill$`));
  await page.getByRole("button", { name: "Create bill", exact: true }).click();
  await expect(page.locator("#line-0-description")).toHaveValue("Consultation");

  const draft = await pick(patient.code);
  await expect(draft.result).toContainText("Draft");
  await draft.result.click();
  await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/bill$`));

  const live = (await (await page.request.get(`/api/registrations/${visit.id}/invoice`)).json()).data;
  const issued = await page.request.post(`/api/invoices/${live.id}/issue`, { data: { revision: live.revision } });
  expect(issued.ok()).toBe(true);
  const done = await pick(patient.code);
  await expect(done.result).toContainText("Issued");
  await done.result.click();
  await expect(page).toHaveURL(new RegExp(`/billing/${live.id}$`));
});
