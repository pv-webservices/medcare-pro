import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedDefaultRoles } from "../../src/lib/defaultRoles";
import { seedFeatureCatalogue } from "../../src/lib/defaultFeatures";

const databaseHost = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(databaseHost)) {
  throw new Error("Refusing E2E fixture writes outside a disposable localhost database.");
}

const db = new PrismaClient();
const password = "Disposable-capacity-test-only-2026!";
type Fixture = { tenantId: string; foreignTenantId: string; name: string; planId: string; higherPlanId: string; removedFeature: string; emails: Record<"owner" | "admin" | "scoped" | "doctor" | "platform" | "foreign", string> };
let fixture: Fixture;

async function signIn(page: Page, kind: keyof Fixture["emails"]) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const signed = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email: fixture.emails[kind], password, callbackUrl: "http://127.0.0.1:33310/dashboard" },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(signed.ok()).toBe(true);
  expect((await signed.json()).url).not.toContain("error=");
  await page.goto(kind === "platform" ? "/owner/dashboard" : "/dashboard");
  await expect(page).toHaveURL(kind === "platform" ? /\/owner\/dashboard/ : /\/dashboard/);
}

async function signedContext(browser: Browser, kind: keyof Fixture["emails"]): Promise<BrowserContext> {
  const context = await browser.newContext();
  await signIn(await context.newPage(), kind);
  return context;
}

async function addClinic(page: Page, name: string) {
  await page.getByRole("button", { name: "Add clinic", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a clinic" });
  await dialog.getByLabel("Clinic name", { exact: true }).fill(name);
  const response = page.waitForResponse((result) => result.url().endsWith("/api/clinics") && result.request().method() === "POST", { timeout: 60_000 });
  await dialog.getByRole("button", { name: "Add clinic", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  // The established form navigates to the created clinic's detail page.
  await page.goto("/clinics");
}

async function submitCapacity(page: Page) {
  const response = page.waitForResponse((result) => result.url().endsWith("/api/clinic-capacity/requests") && result.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Submit request", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.beforeEach(async () => {
  await seedFeatureCatalogue(db);
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const name = `Capacity E2E ${stamp}`;
  const features = await db.feature.findMany({ select: { id: true, key: true, name: true } });
  const removed = features.find((feature) => feature.key === "reports") ?? features.find((feature) => feature.key !== "clinics")!;
  const plan = await db.plan.create({ data: { key: `capacity-e2e-${stamp}`, name: "Capacity Standard", includedClinics: 2, additionalClinicPrice: new Prisma.Decimal("499.00"), additionalClinicCurrency: "INR", additionalClinicBillingInterval: "MONTHLY", features: { create: features.map((feature) => ({ featureId: feature.id, enabled: true })) } } });
  const higher = await db.plan.create({ data: { key: `capacity-e2e-higher-${stamp}`, name: "Capacity Plus", includedClinics: 4, features: { create: features.filter((feature) => feature.id !== removed.id).map((feature) => ({ featureId: feature.id, enabled: true })) } } });
  const tenant = await db.tenant.create({ data: { businessName: name, email: `tenant-${stamp}@example.test`, slug: `capacity-e2e-${stamp}`, emailVerifiedAt: new Date(), status: "ACTIVE", planId: plan.id } });
  const foreign = await db.tenant.create({ data: { businessName: `${name} foreign`, email: `foreign-tenant-${stamp}@example.test`, slug: `capacity-foreign-${stamp}`, emailVerifiedAt: new Date(), status: "ACTIVE", planId: plan.id } });
  await seedDefaultRoles(db, tenant.id);
  await seedDefaultRoles(db, foreign.id);
  const clinic = await db.clinic.create({ data: { tenantId: tenant.id, name: "Original clinic" } });
  const roles = await db.role.findMany({ where: { tenantId: { in: [tenant.id, foreign.id] } } });
  const hash = await bcrypt.hash(password, 4);
  const emails = {} as Fixture["emails"];
  for (const kind of ["owner", "admin", "scoped", "doctor", "platform", "foreign"] as const) {
    const tenantId = kind === "foreign" ? foreign.id : tenant.id;
    const roleKey = kind === "doctor" ? "DOCTOR" : kind === "admin" || kind === "scoped" ? "CLINIC_ADMIN" : "OWNER";
    const role = roles.find((row) => row.tenantId === tenantId && row.key === roleKey)!;
    emails[kind] = `${kind}-${stamp}@example.test`;
    await db.user.create({ data: { tenantId, name: `Capacity ${kind}`, email: emails[kind], passwordHash: hash, emailVerifiedAt: new Date(), accountStatus: "ACTIVE", membershipStatus: "ACTIVE", platformRole: kind === "platform" ? "SUPER_ADMIN" : null, userRoles: kind === "platform" ? undefined : { create: [{ roleId: role.id, clinicId: kind === "scoped" || kind === "doctor" ? clinic.id : null }] } } });
  }
  fixture = { tenantId: tenant.id, foreignTenantId: foreign.id, name, planId: plan.id, higherPlanId: higher.id, removedFeature: removed.name, emails };
});

test.afterEach(async () => {
  if (!fixture) return;
  const tenantIds = [fixture.tenantId, fixture.foreignTenantId];
  const users = await db.user.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true } });
  await db.notification.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorTenantId: { in: tenantIds } }, { actorUserId: { in: users.map((user) => user.id) } }] } });
  await db.tenantClinicCapacityGrant.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.clinicCapacityRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.plan.deleteMany({ where: { id: { in: [fixture.planId, fixture.higherPlanId] } } });
});
test.afterAll(async () => { await db.$disconnect(); });

test("organization creates 1/2 → 2/2, requests capacity, Superadmin approves, 2/3 unlocks and 3/3 re-blocks", async ({ page, browser }) => {
  await signIn(page, "owner");
  await page.goto("/clinics");
  await expect(page.getByText("1 of 2 clinics used", { exact: true })).toBeVisible();
  await addClinic(page, "Second clinic");
  await expect(page.getByText("2 of 2 clinics used", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add clinic", exact: true })).toHaveCount(0);
  const blocked = await page.request.post("/api/clinics", { data: { name: "Bypass attempt" } });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: "CLINIC_LIMIT_REACHED" });
  await page.getByRole("button", { name: "Request another clinic", exact: true }).click();
  const requestDrawer = page.getByRole("dialog", { name: "Request additional clinic capacity" });
  await requestDrawer.getByLabel("Reason / notes (optional)").fill("Opening a new organization clinic.");
  await submitCapacity(page);
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();
  const request = await db.clinicCapacityRequest.findFirstOrThrow({ where: { tenantId: fixture.tenantId } });
  const platformContext = await signedContext(browser, "platform");
  const platformPage = await platformContext.newPage();
  await platformPage.goto(`/owner/clinic-requests?status=ALL&search=${encodeURIComponent(fixture.name)}`);
  await platformPage.getByRole("button", { name: "Review", exact: true }).click();
  await platformPage.getByRole("dialog").getByRole("button", { name: "Confirm payment", exact: true }).click();
  await expect(platformPage.getByRole("dialog")).toHaveCount(0);
  await platformPage.getByRole("button", { name: "Review", exact: true }).click();
  await platformPage.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(() => db.tenantClinicCapacityGrant.count({ where: { sourceRequestId: request.id } })).toBe(1);
  const again = await platformPage.request.post(`/api/owner/clinic-requests/${request.id}/approve`, { data: { confirmation: request.id } });
  expect((await again.json()).data.alreadyApproved).toBe(true);
  await page.reload();
  await expect(page.getByText("2 of 3 clinics used", { exact: true })).toBeVisible();
  await addClinic(page, "Third clinic");
  await expect(page.getByText("3 of 3 clinics used", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add clinic", exact: true })).toHaveCount(0);
  expect(await db.clinic.count({ where: { tenantId: fixture.tenantId } })).toBe(3);
  const actions = (await db.auditLog.findMany({ where: { OR: [{ actorTenantId: fixture.tenantId }, { targetId: request.id }] }, select: { action: true } })).map((row) => row.action);
  expect(actions).toEqual(expect.arrayContaining(["CLINIC_CAPACITY_REQUESTED", "CLINIC_CAPACITY_PAYMENT_CONFIRMED", "CLINIC_CAPACITY_REQUEST_APPROVED"]));
  await platformContext.close();
});

test("request and commercial authority stay tenant-scoped and Superadmin-only", async ({ page, browser }) => {
  await signIn(page, "owner");
  const spoofed = await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1, tenantId: fixture.foreignTenantId, paymentStatus: "CONFIRMED" } });
  expect(spoofed.status()).toBe(400);
  const submitted = await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 } });
  expect(submitted.status()).toBe(201);
  const id = (await submitted.json()).data.id as string;
  expect((await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 } })).status()).toBe(409);
  for (const path of [`/api/owner/clinic-requests/${id}/approve`, "/api/owner/clinic-capacity/grants"]) {
    expect((await page.request.post(path, { data: { confirmation: id, tenantId: fixture.tenantId, quantity: 10, type: "COMPLIMENTARY", reason: "Unauthorized capacity attempt" } })).status()).toBe(404);
  }
  expect((await page.request.patch(`/api/owner/clinic-requests/${id}/payment`, { data: { paymentStatus: "CONFIRMED" } })).status()).toBe(404);
  expect((await page.request.patch("/api/owner/plans/clinic-policy", { data: {} })).status()).toBe(404);
  for (const kind of ["scoped", "doctor", "foreign", "admin"] as const) {
    const context = await signedContext(browser, kind);
    if (kind === "foreign") expect((await context.request.post(`/api/clinic-capacity/requests/${id}/cancel`)).status()).toBe(404);
    else if (kind === "admin") {
      expect((await context.request.post(`/api/clinic-capacity/requests/${id}/cancel`)).status()).toBe(200);
      expect((await context.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 } })).status()).toBe(201);
    } else expect((await context.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 } })).status()).toBe(403);
    await context.close();
  }
  expect(await db.tenantClinicCapacityGrant.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
});

test("plan upgrade reviews feature loss and does not silently change entitlements", async ({ page, browser }) => {
  await signIn(page, "owner");
  expect((await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "PLAN_UPGRADE", requestedPlanId: fixture.planId } })).status()).toBe(400);
  await db.plan.update({ where: { id: fixture.higherPlanId }, data: { isActive: false } });
  expect((await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "PLAN_UPGRADE", requestedPlanId: fixture.higherPlanId } })).status()).toBe(400);
  await db.plan.update({ where: { id: fixture.higherPlanId }, data: { isActive: true } });
  expect((await page.request.post("/api/clinics", { data: { name: "Second clinic" } })).status()).toBe(201);
  await page.goto("/clinics");
  await page.getByRole("button", { name: "View upgrade options" }).click();
  await page.getByRole("dialog").getByLabel("Upgrade option").selectOption(fixture.higherPlanId);
  await submitCapacity(page);
  const request = await db.clinicCapacityRequest.findFirstOrThrow({ where: { tenantId: fixture.tenantId } });
  const context = await signedContext(browser, "platform");
  expect((await context.request.post(`/api/owner/clinic-requests/${request.id}/approve`, { data: { confirmation: request.id } })).status()).toBe(409);
  expect((await db.tenant.findUniqueOrThrow({ where: { id: fixture.tenantId } })).planId).toBe(fixture.planId);
  const ownerPage = await context.newPage();
  await ownerPage.goto(`/owner/clinic-requests?status=ALL&search=${encodeURIComponent(fixture.name)}`);
  await ownerPage.getByRole("button", { name: "Review", exact: true }).click();
  await expect(ownerPage.getByRole("dialog").getByText(`Features lost: ${fixture.removedFeature}`, { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("dialog").getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await ownerPage.getByRole("dialog").getByRole("checkbox").check();
  await ownerPage.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await db.tenant.findUniqueOrThrow({ where: { id: fixture.tenantId } })).planId).toBe(fixture.higherPlanId);
  await page.reload();
  await expect(page.getByText("2 of 4 clinics used", { exact: true })).toBeVisible();
  await context.close();
});

test("Superadmin reason gates, payment attention, rejection, manual grant, revocation and plan policy are audited", async ({ page, browser }) => {
  await signIn(page, "owner");
  const submitted = await page.request.post("/api/clinic-capacity/requests", { data: { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 } });
  const id = (await submitted.json()).data.id as string;
  const context = await signedContext(browser, "platform");
  expect((await context.request.patch(`/api/owner/clinic-requests/${id}/payment`, { data: { paymentStatus: "FAILED", reviewNote: "Local test payment needs attention." } })).status()).toBe(200);
  expect(await db.notification.count({ where: { tenantId: fixture.tenantId, type: "clinic.capacity_payment_attention" } })).toBeGreaterThan(0);
  expect((await context.request.post(`/api/owner/clinic-requests/${id}/reject`, { data: { reason: "short" } })).status()).toBe(400);
  expect((await context.request.post(`/api/owner/clinic-requests/${id}/reject`, { data: { reason: "Commercial arrangement was not approved." } })).status()).toBe(200);
  expect((await context.request.post(`/api/owner/clinic-requests/${id}/approve`, { data: { confirmation: id } })).status()).toBe(409);
  const grantInput = { tenantId: fixture.tenantId, quantity: 1, type: "COMPLIMENTARY", reason: "Approved local verification arrangement." };
  expect((await context.request.post("/api/owner/clinic-capacity/grants", { data: { ...grantInput, reason: "short" } })).status()).toBe(400);
  const granted = await context.request.post("/api/owner/clinic-capacity/grants", { data: grantInput });
  expect(granted.status()).toBe(201);
  const grantId = (await granted.json()).data.id as string;
  expect((await page.request.get("/api/clinic-capacity")).status()).toBe(200);
  expect((await (await page.request.get("/api/clinic-capacity")).json()).data.effectiveLimit).toBe(3);
  expect((await page.request.post("/api/clinics", { data: { name: "Second granted clinic" } })).status()).toBe(201);
  expect((await page.request.post("/api/clinics", { data: { name: "Third granted clinic" } })).status()).toBe(201);
  expect((await context.request.post(`/api/owner/clinic-capacity/grants/${grantId}/revoke`, { data: { reason: "short" } })).status()).toBe(400);
  expect((await context.request.post(`/api/owner/clinic-capacity/grants/${grantId}/revoke`, { data: { reason: "Local verification grant has ended." } })).status()).toBe(200);
  expect((await (await page.request.get("/api/clinic-capacity")).json()).data.effectiveLimit).toBe(2);
  expect(await db.clinic.count({ where: { tenantId: fixture.tenantId } })).toBe(3);
  expect((await (await page.request.get("/api/clinic-capacity")).json()).data.status).toBe("OVER_LIMIT");
  expect((await (await page.request.get("/api/clinics")).json()).data).toHaveLength(3);
  expect((await page.request.post("/api/clinics", { data: { name: "Over-limit attempt" } })).status()).toBe(409);
  const policy = { planKey: (await db.plan.findUniqueOrThrow({ where: { id: fixture.planId } })).key, includedClinics: 4, additionalClinicPrice: "499.00", additionalClinicCurrency: "INR", additionalClinicBillingInterval: "MONTHLY", reason: "Reviewed local plan allowance change." };
  expect((await context.request.patch("/api/owner/plans/clinic-policy", { data: { ...policy, reason: "short" } })).status()).toBe(400);
  expect((await context.request.patch("/api/owner/plans/clinic-policy", { data: policy })).status()).toBe(200);
  const actions = (await db.auditLog.findMany({ where: { targetId: { in: [id, grantId, fixture.planId] } }, select: { action: true } })).map((row) => row.action);
  expect(actions).toEqual(expect.arrayContaining(["CLINIC_CAPACITY_PAYMENT_FAILED", "CLINIC_CAPACITY_REQUEST_REJECTED", "CLINIC_CAPACITY_GRANTED", "CLINIC_CAPACITY_REVOKED", "PLAN_CLINIC_LIMIT_CHANGED"]));
  await context.close();
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`${viewport.name}: capacity card, request drawer, owner table and review fit the viewport`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize(viewport);
    await signIn(page, "owner");
    await page.goto("/clinics");
    await expect(page.getByText("1 of 2 clinics used", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-under-limit.png`), fullPage: true });
    expect((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))).toBe(true);
    expect((await page.request.post("/api/clinics", { data: { name: "Second clinic" } })).status()).toBe(201);
    await page.reload();
    await page.getByRole("button", { name: "Request another clinic", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-request.png`), fullPage: true });
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    await submitCapacity(page);
    const context = await signedContext(browser, "platform");
    const ownerPage = await context.newPage();
    await ownerPage.setViewportSize(viewport);
    await ownerPage.goto(`/owner/clinic-requests?status=ALL&search=${encodeURIComponent(fixture.name)}`);
    expect((await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))).toBe(true);
    await ownerPage.screenshot({ path: testInfo.outputPath(`${viewport.name}-owner-list.png`), fullPage: true });
    await ownerPage.getByRole("button", { name: "Review", exact: true }).click();
    await expect(ownerPage.getByRole("dialog")).toBeVisible();
    await ownerPage.screenshot({ path: testInfo.outputPath(`${viewport.name}-owner-review.png`), fullPage: true });
    expect((await ownerPage.getByRole("dialog").boundingBox())!.width).toBeLessThanOrEqual(viewport.width);
    await ownerPage.keyboard.press("Escape");
    await expect(ownerPage.getByRole("dialog")).toHaveCount(0);
    await context.close();
  });
}
