import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { assertBillingTestDatabase, BILLING_TEST_PASSWORD, createBillingFixture } from "../../scripts/billing-test-fixture";

// A catalogue feature with no `features` row must stay closed (fail-closed is
// unchanged) but be VISIBLE: a banner on Settings → Features and a note on the
// Roles & Permissions group. Disposable localhost database only: the billing
// row is deleted, then restored by the same create-only catalogue seed.
assertBillingTestDatabase();
const db = new PrismaClient();
let f: Awaited<ReturnType<typeof createBillingFixture>>;
test.beforeAll(async () => {
  f = await createBillingFixture(db);
});
test.afterAll(async () => {
  // Always put the row (and its Standard-plan link) back for the other billing specs.
  await seedFeatureCatalogue(db);
  await db.$disconnect();
});

async function signIn(page: Page, email: string) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password: BILLING_TEST_PASSWORD, callbackUrl: "http://127.0.0.1:33313/dashboard" },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(response.ok()).toBe(true);
}

test("a missing billing feature row shows an install banner and stays closed", async ({ page }, testInfo) => {
  await signIn(page, f.owner.email);
  await page.goto("/settings/features");
  await expect(page.getByText("is available in this version but not installed on this database")).toHaveCount(0);

  await db.feature.delete({ where: { key: "billing" } });
  expect(await db.feature.count({ where: { key: "billing" } })).toBe(0);

  await page.goto("/settings/features");
  const banner = page.getByRole("status").filter({ hasText: "not installed on this database" });
  await expect(banner).toContainText(
    "Patient billing is available in this version but not installed on this database. An administrator must run: npm run billing:backfill",
  );
  await page.screenshot({ path: testInfo.outputPath("features-missing-billing.png"), fullPage: true });
  // Read-only: viewing the banner installed nothing.
  expect(await db.feature.count({ where: { key: "billing" } })).toBe(0);
  // Fail-closed unchanged: no Billing entry in the menu, and the module refuses.
  await expect(page.locator('a[href="/billing"]')).toHaveCount(0);
  expect((await page.goto("/billing"))!.status()).toBe(404);

  const role = await db.role.findFirstOrThrow({ where: { tenantId: f.tenant.id, name: "Synthetic billing owner" } });
  await page.goto(`/settings/roles?roleId=${role.id}`);
  const billingGroup = page.locator('section[aria-labelledby="module-heading-Billing"]');
  await expect(billingGroup).toContainText("Module not installed on this database");
  await expect(page.locator('section[aria-labelledby="module-heading-Prescriptions"]')).not.toContainText("Module not installed");
  await billingGroup.screenshot({ path: testInfo.outputPath("roles-billing-not-installed.png") });

  await seedFeatureCatalogue(db);
  await page.goto("/settings/features");
  await expect(page.getByText("not installed on this database")).toHaveCount(0);
});
