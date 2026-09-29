import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertBillingTestDatabase, BILLING_TEST_PASSWORD, createBillingFixture } from "../../scripts/billing-test-fixture";

assertBillingTestDatabase();
const db = new PrismaClient();
let f: Awaited<ReturnType<typeof createBillingFixture>>;
test.beforeAll(async () => {
  f = await createBillingFixture(db);
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
/** No sideways scrolling at any width, the 375px phone included. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
async function voidFirstPayment(page: Page, reason: string) {
  const before = await page.getByRole("button", { name: "Void", exact: true }).count();
  await page.getByRole("button", { name: "Void", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Void payment", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Void", exact: true })).toHaveCount(before - 1);
}

test("bill a visit, take part and full payment, print, void, cancel and replace", async ({ page }, testInfo) => {
  const visit = await f.visit();
  await signIn(page, f.owner.email);

  // Create the bill from the registration; the visit amount pre-fills a Consultation line.
  await page.goto(`/registration/${visit.id}`);
  await page.getByRole("link", { name: "Create bill", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/bill$`));
  await page.getByRole("button", { name: "Create bill", exact: true }).click();
  await expect(page.locator("#line-0-description")).toHaveValue("Consultation");
  await expect(page.locator("#line-0-price")).toHaveValue("300.00");

  // Add a price-list service and a custom line, then 10% off the service.
  await page.locator("#bill-service").selectOption(f.service.id);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(page.locator("#line-1-description")).toHaveValue("Synthetic X-ray");
  await page.getByRole("button", { name: "Add custom line", exact: true }).click();
  await page.locator("#line-2-description").fill("Synthetic dressing");
  await page.locator("#line-2-price").fill("200.00");
  await page.locator("#line-1-percent").fill("10");
  await page.getByRole("group", { name: "Line 2" }).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#line-1-discount")).toHaveValue("50.00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved.");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("bill-editor.png"), fullPage: true });

  // Review, then an explicit Issue.
  await page.getByRole("button", { name: "Review bill", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Grand total: ₹950.00");
  await page.getByRole("dialog").getByRole("button", { name: "Issue bill", exact: true }).click();
  await expect(page).toHaveURL(/\/billing\/[^/]+$/);
  const billId = page.url().split("/").at(-1)!;
  const heading = page.getByRole("heading", { level: 1, name: /^INV-\d{4}-\d{5} · Issued$/ });
  await expect(heading).toBeVisible();
  const invoiceNumber = (await heading.textContent())!.split(" · ")[0];

  // A partial UPI payment.
  await page.locator("#payment-amount").fill("400.00");
  await page.locator("#payment-mode").selectOption("UPI");
  await page.locator("#payment-reference").fill("UTR-E2E-0001");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByText("Partly paid", { exact: true })).toBeVisible();
  await expect(page.locator("#payment-amount")).toHaveValue("550.00");

  // The dues list shows the balance.
  await page.goto(`/billing/dues?search=${encodeURIComponent(invoiceNumber)}`);
  const due = page.getByRole("row").filter({ has: page.getByRole("link", { name: invoiceNumber, exact: true }) });
  await expect(due).toContainText("₹550.00");
  await expect(due).toContainText("Partly paid");
  await expectNoHorizontalScroll(page);

  // Record the rest in cash: the bill is Paid and takes no further payment.
  await page.goto(`/billing/${billId}`);
  await page.locator("#payment-mode").selectOption("CASH");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const paymentStatus = page.locator("dl").filter({ has: page.getByText("Status", { exact: true }) }).locator("dd").first();
  await expect(paymentStatus).toHaveText("Paid");
  await expect(page.locator("#payment-amount")).toHaveCount(0);
  await page.goto(`/billing/dues?search=${encodeURIComponent(invoiceNumber)}`);
  await expect(page.getByText("No outstanding bills match these filters.")).toBeVisible();

  // Print renders from the snapshot, outside the dashboard, with live payments.
  await page.goto(`/billing/${billId}`);
  await page.getByRole("link", { name: "Print bill", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/billing/${billId}/print$`));
  await expect(page.locator("nav")).toHaveCount(0);
  const printed = page.locator(".invoice-document");
  await expect(printed.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
  await expect(printed).toContainText(invoiceNumber);
  await expect(printed).toContainText("Synthetic dressing");
  await expect(printed).toContainText("Rupees Nine Hundred Fifty Only");
  await expect(printed).toContainText("Payments as of");
  await expect(printed).toContainText("UTR-E2E-0001");
  await expect(printed).toContainText("Synthetic footer note for E2E.");
  await expect(printed).toContainText("This is a computer-generated document.");
  await expect(page.locator(".invoice-watermark")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("bill-print.png"), fullPage: true });
  // A4 at 14mm margins leaves ~182mm (688px) for the document: the line table must fit it.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 688, height: 1000 });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".invoice-print-controls")).toBeHidden();
  const tableOverflow = await page.locator(".invoice-lines").evaluate((box) => box.querySelector("table")!.scrollWidth - box.clientWidth);
  expect(tableOverflow).toBeLessThanOrEqual(0);
  await page.pdf({ path: testInfo.outputPath("bill-a4.pdf"), format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize(viewport);
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printInvoked = "yes"; }; });
  await page.getByRole("button", { name: "Print bill", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-invoked", "yes");

  // Cancel is blocked while payments are active; void both, then cancel.
  await page.goto(`/billing/${billId}`);
  await expect(page.getByRole("button", { name: "Cancel bill", exact: true })).toBeDisabled();
  await expect(page.getByText("Void the 2 active payments before cancelling this bill.")).toBeVisible();
  await voidFirstPayment(page, "Synthetic E2E mistaken entry");
  await voidFirstPayment(page, "Synthetic E2E mistaken entry");
  await expect(page.getByText("Unpaid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel bill", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Synthetic E2E wrong bill");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel bill", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${invoiceNumber} · Cancelled` })).toBeVisible();

  // A cancelled bill prints with the watermark and its reason.
  await page.goto(`/billing/${billId}/print`);
  await expect(page.locator(".invoice-watermark")).toHaveText("CANCELLED");
  await expect(page.locator(".invoice-document")).toContainText("Reason: Synthetic E2E wrong bill");
  await expect(page.locator(".invoice-document")).toContainText("— (cancelled)");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("bill-print-cancelled.png"), fullPage: true });

  // Replacement: a new draft with the lines copied. A draft has no print page.
  await page.goto(`/billing/${billId}`);
  await page.getByRole("button", { name: "Create replacement", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/bill$`));
  await expect(page.locator("#line-2-description")).toHaveValue("Synthetic dressing");
  const live = await (await page.request.get(`/api/registrations/${visit.id}/invoice`)).json();
  expect(live.data.status).toBe("DRAFT");
  expect((await page.goto(`/billing/${live.data.id}/print`))!.status()).toBe(404);
  await page.goto(`/registration/${visit.id}/bill`);
  await page.getByRole("button", { name: "Review bill", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Issue bill", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/billing/${live.data.id}$`));
  const replacementHeading = page.getByRole("heading", { level: 1, name: /^INV-\d{4}-\d{5} · Issued$/ });
  await expect(replacementHeading).toBeVisible();
  expect((await replacementHeading.textContent())!.split(" · ")[0]).not.toBe(invoiceNumber);
  await expect(page.getByText("Replaces a")).toBeVisible();

  // Reports: the Billing section, after the unchanged revenue report.
  await page.goto("/reports?period=monthly");
  const billing = page.locator('section[aria-labelledby="billing-report-title"]');
  await expect(billing.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(billing).toContainText("Revenue is by visit date. Collections are by payment date.");
  await expect(billing.getByRole("heading", { name: "Billed", exact: true })).toBeVisible();
  await expect(billing.getByRole("heading", { name: "Collected", exact: true })).toBeVisible();
  // Only the replacement is billed; the cancelled bill and the voided payments never count.
  const tile = (label: string) => billing.locator("div.rounded-3xl").filter({ hasText: label }).first();
  await expect(tile("Billed")).toContainText("₹950.00");
  await expect(tile("Collected")).toContainText("₹0.00");
  await expect(tile("Outstanding now")).toContainText("₹950.00");
  await expect(billing.getByRole("link", { name: "Export billing figures by clinic as CSV" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await billing.screenshot({ path: testInfo.outputPath("reports-billing.png") });
});
