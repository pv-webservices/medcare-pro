/**
 * Stage-8 verification — WhatsApp templates and sending, exercised against a
 * LOCAL database and a LOCAL stub gateway.
 *
 *     npm run verify:whatsapp
 *
 * The stub is the point: it stands in for RkvRobo on 127.0.0.1 and replays the
 * exact response shapes the live API returns — `{"status":true,...}` with a
 * `data.key.id`, and `{"status":false,"msg":"..."}` with HTTP 400. That
 * exercises the real client (URL building, POST body, response parsing, id
 * extraction, failure handling) **without sending a single real message**.
 *
 * Nothing here ever touches bot.rkvrobo.in. WHATSAPP_BSP_API_BASE_URL is
 * pointed at the stub before any send, so a misconfigured .env cannot cause a
 * live send from a test run.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encryptWhatsappApiKey } from "@/lib/whatsappCredentialCrypto";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles, OWNER_ROLE_NAME } from "@/lib/defaultRoles";
import { DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { createClinic } from "@/lib/clinics";
import { createRegistration } from "@/lib/registrations";
import {
  renderTemplate,
  unknownPlaceholders,
} from "@/lib/whatsappTemplateText";
import {
  createTemplate,
  createTemplateSchema,
  deleteTemplate,
  listTemplatesForActor,
  updateTemplate,
} from "@/lib/whatsappTemplates";
import {
  ALREADY_SENT_TODAY_REASON,
  listMessagesForActor,
  IN_FLIGHT_STATUS,
  listSentTemplateToday,
  sendMessageSchema,
  sendToPatients,
} from "@/lib/whatsappMessages";

/**
 * One template reaches a patient once a day, so a section that re-sends to the
 * same fixture patient first moves this tenant's history back a day.
 */
async function startNextDay(tenantId: string): Promise<void> {
  const rows = await prisma.whatsappMessage.findMany({
    where: { clinic: { tenantId } },
    select: { id: true, sentAt: true },
  });
  for (const row of rows) {
    await prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { sentAt: new Date(row.sentAt.getTime() - 24 * 60 * 60 * 1000) },
    });
  }
}

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  is: (error: unknown) => boolean,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

// ---------------------------------------------------------------------------
// Stub gateway — replays RkvRobo's real response shapes
// ---------------------------------------------------------------------------

interface StubCall {
  path: string;
  body: Record<string, unknown>;
}

const calls: StubCall[] = [];
/** Numbers the stub refuses, to exercise the per-recipient failure path. */
const rejectNumbers = new Set<string>();
/** Numbers /check-number reports as having no WhatsApp account. */
const notOnWhatsapp = new Set<string>();
/** What /info-devices reports, so the connected/disconnected paths both run. */
let deviceStatus = "Connected";
/**
 * Which /check-number body to send back. "boolean" is what the LIVE API does;
 * "object" is what its docs claim; "unknown" proves an unrecognised shape is
 * treated as inconclusive rather than as "not on WhatsApp".
 */
let checkNumberShape: "boolean" | "object" | "unknown" = "boolean";
/**
 * Never reset, unlike `calls` — real WhatsApp message ids are unique forever,
 * and `whatsapp_messages.provider_message_id` is uniquely indexed to keep a
 * future delivery callback idempotent. Deriving the id from `calls.length`
 * would replay ids after each section clears the array.
 */
let messageSeq = 0;

const stub = createServer((req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }

    calls.push({ path: req.url ?? "", body });
    res.setHeader("Content-Type", "application/json");

    if (typeof body.api_key !== "string" || body.api_key === "") {
      // The live API's exact behaviour: auth before parameter validation.
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          status: false,
          msg: "Invalid API key. Please provide a valid api_key.",
        }),
      );
      return;
    }

    // /check-number — `msg` is NOT a string here. The live API returns a plain
    // BOOLEAN (verified against bot.rkvrobo.in), while its docs show an object;
    // the stub can produce either, plus an unrecognised shape, so the client is
    // proven to handle all three.
    if ((req.url ?? "").includes("/check-number")) {
      const exists = !notOnWhatsapp.has(String(body.number));
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          status: true,
          msg:
            checkNumberShape === "boolean"
              ? exists
              : checkNumberShape === "object"
                ? { exists, jid: `${String(body.number)}@s.whatsapp.net` }
                : "unexpected",
        }),
      );
      return;
    }

    // /info-devices — {status, info:[{...}]}, no msg at all.
    if ((req.url ?? "").includes("/info-devices")) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          status: true,
          info: [
            {
              id: 1,
              body: String(body.number),
              webhook: null,
              status: deviceStatus,
              message_sent: 2,
            },
          ],
        }),
      );
      return;
    }

    if (rejectNumbers.has(String(body.number))) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({ status: false, msg: "Device not connected." }),
      );
      return;
    }

    messageSeq += 1;
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: true,
        msg: "Message sent successfully!",
        data: {
          key: {
            remoteJid: `${String(body.number)}@c.us`,
            fromMe: true,
            id: `3EB0STUB${Date.now()}${messageSeq}`,
          },
          messageTimestamp: "1755623949",
        },
      }),
    );
  });
});

async function startStub(): Promise<string> {
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not start the stub gateway.");
  }
  return `http://127.0.0.1:${address.port}/api`;
}

const TEST_TENANT_NAME = "verify-whatsapp";

async function build() {
  // Module access is plan-gated; without a plan, createClinic is refused.
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${Date.now()}@example.test`,
      // Stage 3 made tenants.slug NOT NULL. Mirrors the email's uniqueness.
      slug: `${TEST_TENANT_NAME}-${Date.now()}`,
      emailVerifiedAt: new Date(),
      planId: plan.id,
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Asha Owner",
      email: `owner-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId(OWNER_ROLE_NAME) }] },
    },
    select: { id: true },
  });
  const ownerActor = { userId: owner.id, tenantId: tenant.id };

  const clinicA = await createClinic(ownerActor, { name: "Alpha Clinic" });
  const clinicB = await createClinic(ownerActor, { name: "Beta Clinic" });

  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Front Desk",
      email: `staff-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Staff"), clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  // Holds message:send but NOT message:template — the split the PRD's
  // "front desk sends, admin writes" reading depends on.
  const senderRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Sender Only",
      permissions: ["message:send", "patient:read", "clinic:read"],
    },
    select: { id: true },
  });
  const sender = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Sender Only",
      email: `sender-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: senderRole.id, clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  const doctor = await prisma.doctor.create({
    data: { clinicId: clinicA.id, name: "Dr Rao", department: "Cardiology" },
    select: { id: true },
  });
  // A registration's doctor must work at its clinic.
  const clinicBDoctor = await prisma.doctor.create({
    data: { clinicId: clinicB.id, name: "Dr Iyer", department: "Dermatology" },
    select: { id: true },
  });

  const first = await createRegistration(ownerActor, {
    clinicId: clinicA.id,
    name: "Ramesh Kumar",
    mobileNumber: "919800000001",
    age: 40,
    gender: "Male",
    city: "Bengaluru",
    address: "10 Main Road",
    doctorId: doctor.id,
    department: "Cardiology",
    amount: 500,
    visitDate: "2026-08-10",
    visitTime: "14:30",
  });

  const second = await createRegistration(ownerActor, {
    clinicId: clinicA.id,
    name: "Sunita Desai",
    // Deliberately unusable: too few digits once punctuation is stripped.
    mobileNumber: "12345",
    age: 35,
    gender: "Female",
    city: "Bengaluru",
    address: "12 Cross Road",
    doctorId: doctor.id,
    department: "Cardiology",
    amount: 250,
    visitDate: "2026-08-12",
    visitTime: "09:05",
  });

  const otherClinic = await createRegistration(ownerActor, {
    clinicId: clinicB.id,
    name: "Priya Nair",
    mobileNumber: "919800000003",
    age: 28,
    gender: "Female",
    city: "Bengaluru",
    address: "44 Palm Grove",
    doctorId: clinicBDoctor.id,
    department: "Dermatology",
    amount: 1000,
    visitDate: "2026-08-11",
    visitTime: "12:00",
  });

  return {
    tenantId: tenant.id,
    clinicA: clinicA.id,
    clinicB: clinicB.id,
    ownerActor,
    staffActor: { userId: staff.id, tenantId: tenant.id },
    senderActor: { userId: sender.id, tenantId: tenant.id },
    ramesh: first.patientId,
    sunita: second.patientId,
    priya: otherClinic.patientId,
  };
}

/**
 * Sends resolve their gateway from the database (the account's default
 * device), not from the environment, so the test account gets a provider
 * account and a connected device that both point at the stub. The API key is
 * encrypted with a throwaway key generated for this run.
 */
async function connectStubDevice(tenantId: string, baseUrl: string): Promise<void> {
  process.env.WHATSAPP_PROVIDER_ENCRYPTION_KEY = randomBytes(32).toString("hex");

  const account = await prisma.whatsappProviderAccount.create({
    data: { tenantId, name: "Stub gateway", apiBaseUrl: baseUrl, encryptedApiKey: "pending" },
    select: { id: true },
  });
  await prisma.whatsappProviderAccount.update({
    where: { id: account.id },
    data: { encryptedApiKey: encryptWhatsappApiKey("STUB_KEY", tenantId, account.id) },
  });
  const device = await prisma.whatsappDevice.create({
    data: {
      tenantId,
      providerAccountId: account.id,
      name: "Stub device",
      phoneNumber: "919999999999",
      connectionStatus: "CONNECTED",
      lastStatusCheckedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.tenantWhatsappSettings.create({
    data: { tenantId, defaultDeviceId: device.id },
  });
}

async function main(): Promise<void> {
  const baseUrl = await startStub();
  // Pointed at the stub BEFORE anything can send. Belt and braces: the real
  // key is also replaced, so even a wrong base url cannot authenticate live.
  process.env.WHATSAPP_BSP_API_BASE_URL = baseUrl;
  process.env.WHATSAPP_BSP_API_KEY = "STUB_KEY";
  process.env.WHATSAPP_BSP_SENDER = "919999999999";
  process.env.WHATSAPP_WEBHOOK_TOKEN = "stub-webhook-token";
  console.log(`  (stub gateway on ${baseUrl} — no live sends)\n`);

  const t = await build();
  await connectStubDevice(t.tenantId, baseUrl);

  console.log("Placeholder rendering (pure)");
  check(
    "known placeholders are substituted",
    renderTemplate("Hi {patientName}, ID {patientCode}.", {
      patientName: "Ramesh",
      patientCode: "PT-2026-0001",
    }) === "Hi Ramesh, ID PT-2026-0001.",
  );
  check(
    "a known placeholder with no value becomes a dash, not a hole",
    renderTemplate("Doctor: {doctorName}", {}) === "Doctor: —",
  );
  check(
    "an unknown token is left visible rather than blanked",
    renderTemplate("Hi {doctrName}", {}) === "Hi {doctrName}",
  );
  check(
    "unknown tokens are detectable",
    unknownPlaceholders("{patientName} and {nope}").join(",") === "nope",
  );

  console.log("\nFR-9.1 templates are the approved set");
  const reminder = await createTemplate(t.ownerActor, {
    name: "Appointment reminder",
    body: "Hi {patientName}, your visit at {clinicName} is on {visitDate} at {visitTime} with {doctorName}.",
    footer: "Sent by the clinic",
  });
  check(
    "template records which placeholders it uses",
    reminder.placeholders.join(",") ===
      "patientName,clinicName,visitDate,visitTime,doctorName",
    reminder.placeholders,
  );

  await expectThrows(
    "a duplicate template name is a 409",
    () =>
      createTemplate(t.ownerActor, {
        name: "Appointment reminder",
        body: "Hello again",
      }),
    (error) => error instanceof ConflictError,
  );
  await expectThrows(
    "a body with an unfillable placeholder is rejected",
    async () =>
      createTemplateSchema.parse({
        name: "Broken",
        body: "Hi {doctrName}",
      }),
    (error) => error instanceof Error && error.name === "ZodError",
  );
  await expectThrows(
    "media needs both a type and a link",
    async () =>
      createTemplateSchema.parse({
        name: "Half media",
        body: "See attached",
        mediaType: "image",
      }),
    (error) => error instanceof Error && error.name === "ZodError",
  );
  await expectThrows(
    "the send API refuses a free-text body — there is no such field",
    async () =>
      sendMessageSchema.parse({
        message: "anything I like",
        patientIds: [t.ramesh],
      }),
    (error) => error instanceof Error && error.name === "ZodError",
  );

  console.log("\nRBAC — writing wording is separate from sending it");
  await expectThrows(
    "message:send alone cannot create a template",
    () =>
      createTemplate(t.senderActor, { name: "Sneaky", body: "Hi {patientName}" }),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "nor edit one",
    () =>
      updateTemplate(t.senderActor, {
        templateId: reminder.id,
        body: "Buy our new offer!",
      }),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "nor delete one",
    () => deleteTemplate(t.senderActor, reminder.id),
    (error) => error instanceof PermissionError,
  );
  check(
    "but can read the list to choose from",
    (await listTemplatesForActor(t.senderActor)).length === 1,
  );
  await expectThrows(
    "Staff hold message:send nowhere, so cannot even list",
    () => listTemplatesForActor(t.staffActor),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "and cannot send",
    () => sendToPatients(t.staffActor, { templateId: reminder.id, patientIds: [t.ramesh] }),
    (error) => error instanceof PermissionError,
  );

  console.log("\nPRD §9 scoping");
  const otherTenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-other-${Date.now()}@example.test`,
      // Stage 3 made tenants.slug NOT NULL. Mirrors the email's uniqueness.
      slug: `${TEST_TENANT_NAME}-other-${Date.now()}`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const foreignTemplate = await prisma.whatsappTemplate.create({
    data: { tenantId: otherTenant.id, name: "Foreign", body: "Hi" },
    select: { id: true },
  });
  await expectThrows(
    "another account's template cannot be sent",
    () =>
      sendToPatients(t.ownerActor, {
        templateId: foreignTemplate.id,
        patientIds: [t.ramesh],
      }),
    (error) => error instanceof ScopeError,
  );
  await expectThrows(
    "another account's template cannot be edited",
    () => updateTemplate(t.ownerActor, { templateId: foreignTemplate.id, body: "x" }),
    (error) => error instanceof ScopeError,
  );

  console.log("\nFR-9.1 sending");
  calls.length = 0;
  const sent = await sendToPatients(t.ownerActor, {
    templateId: reminder.id,
    patientIds: [t.ramesh],
  });
  check("one recipient, one send", sent.sent === 1 && sent.failed === 0, sent);
  check("two gateway calls: check then send", calls.length === 2, calls.length);
  check(
    "the number is checked before it is messaged",
    calls[0].path.endsWith("/check-number"),
    calls.map((call) => call.path),
  );
  check("then the send follows", calls[1].path.endsWith("/send-message"));
  check("the api key came from the environment", calls[1].body.api_key === "STUB_KEY");
  check("full=1 was requested, so the message id comes back", calls[1].body.full === 1);
  check("the configured device is named as sender", calls[1].body.sender === "919999999999");
  check(
    "the rendered body carries real values, not placeholders",
    String(calls[1].body.message).startsWith("Hi Ramesh Kumar, your visit at Alpha Clinic is on 2026-08-10 at 14:30 with Dr Rao."),
    calls[1].body.message,
  );
  check(
    "the number was reduced to digits",
    calls[1].body.number === "919800000001",
    calls[1].body.number,
  );

  const logged = await listMessagesForActor(t.ownerActor);
  check("the send was logged", logged.length === 1);
  check("status is the gateway's acceptance, recorded as sent", logged[0].status === "sent");
  check(
    "the WhatsApp message id was captured from data.key.id",
    logged[0].providerMessageId?.startsWith("3EB0STUB") === true,
    logged[0].providerMessageId,
  );
  check(
    "the template name is denormalised onto the message",
    logged[0].templateName === "Appointment reminder",
  );

  console.log("\nThe same template reaches a patient once a day");
  calls.length = 0;
  const repeat = await sendToPatients(t.ownerActor, {
    templateId: reminder.id,
    patientIds: [t.ramesh],
  });
  check(
    "a second send today is skipped, not sent",
    repeat.skipped === 1 && repeat.sent === 0 && repeat.failed === 0,
    repeat,
  );
  check(
    "and says why",
    repeat.results[0]?.status === "skipped" &&
      repeat.results[0]?.failureReason === ALREADY_SENT_TODAY_REASON,
    repeat.results[0],
  );
  check("the gateway was never called", calls.length === 0, calls.length);
  check(
    "a skip writes no history row",
    (await listMessagesForActor(t.ownerActor)).length === 1,
  );
  const marker = await listSentTemplateToday(t.ownerActor, reminder.id, t.clinicA);
  check("the composer's marker lists that patient", marker.patientIds.includes(t.ramesh));
  check(
    "and their normalised number",
    marker.mobileNumbers.includes("919800000001"),
    marker.mobileNumbers,
  );
  await startNextDay(t.tenantId);
  check(
    "and clears once the day turns over",
    (await listSentTemplateToday(t.ownerActor, reminder.id, t.clinicA)).patientIds.length === 0,
  );

  console.log("\nA bad recipient never takes the batch down");
  calls.length = 0;
  rejectNumbers.add("919800000003");
  const batch = await sendToPatients(t.ownerActor, {
    templateId: reminder.id,
    // Ramesh is fine; Sunita's number is unusable; Priya is refused by the gateway.
    patientIds: [t.ramesh, t.sunita, t.priya],
  });
  check("every recipient is reported", batch.results.length === 3, batch.results);
  check("the good one still went", batch.sent === 1, batch);
  check("the other two are marked failed", batch.failed === 2, batch);
  check(
    // Ramesh: check + send. Sunita: nothing, rejected locally. Priya: check +
    // send (which the gateway then refuses).
    "an unusable number is caught before the gateway is called",
    calls.length === 4 && calls.every((call) => !call.body.number?.toString().includes("12345")),
    calls.map((call) => `${call.path} ${String(call.body.number)}`),
  );
  check(
    "and its reason names the number rather than a generic error",
    batch.results
      .find((result) => result.patientId === t.sunita)
      ?.failureReason?.includes("12345") === true,
    batch.results.find((result) => result.patientId === t.sunita),
  );
  check(
    "a gateway refusal is recorded verbatim",
    batch.results.find((result) => result.patientId === t.priya)?.failureReason ===
      "Device not connected.",
    batch.results.find((result) => result.patientId === t.priya),
  );

  const afterBatch = await listMessagesForActor(t.ownerActor);
  check(
    "failed sends are logged too, not silently dropped",
    afterBatch.length === 4,
    afterBatch.length,
  );
  check(
    "a failure carries its reason into the history",
    afterBatch.some(
      (message) =>
        message.status === "failed" && message.failureReason === "Device not connected.",
    ),
  );
  rejectNumbers.delete("919800000003");

  console.log("\nA clinic-scoped sender reaches only their own patients");
  await startNextDay(t.tenantId);
  calls.length = 0;
  const scopedSend = await sendToPatients(t.senderActor, {
    templateId: reminder.id,
    patientIds: [t.ramesh, t.priya],
  });
  check(
    "the out-of-reach patient is silently dropped, not messaged",
    scopedSend.results.length === 1 && scopedSend.results[0].patientId === t.ramesh,
    scopedSend.results,
  );
  check("so only one recipient reached the gateway", calls.length === 2, calls.length);

  await expectThrows(
    "and a send to only out-of-reach patients is a 400, not a silent success",
    () => sendToPatients(t.senderActor, { templateId: reminder.id, patientIds: [t.priya] }),
    (error) => error instanceof BadRequestError,
  );

  const scopedHistory = await listMessagesForActor(t.senderActor);
  check(
    "their history shows only their clinic",
    scopedHistory.every((message) => message.clinicName === "Alpha Clinic"),
    scopedHistory.map((message) => message.clinicName),
  );

  console.log("\nMedia templates use the media endpoint");
  const leaflet = await createTemplate(t.ownerActor, {
    name: "Care leaflet",
    body: "Hi {patientName}, here is your aftercare leaflet.",
    mediaType: "document",
    mediaUrl: "https://example.com/leaflet.pdf",
  });
  calls.length = 0;
  await sendToPatients(t.ownerActor, {
    templateId: leaflet.id,
    patientIds: [t.ramesh],
  });
  check("it hit /send-media", calls[1].path.endsWith("/send-media"), calls[1].path);
  check("with the media type", calls[1].body.media_type === "document");
  check("and the direct link", calls[1].body.url === "https://example.com/leaflet.pdf");
  check(
    "the rendered text travels as the caption",
    String(calls[1].body.caption).startsWith("Hi Ramesh Kumar,"),
    calls[1].body.caption,
  );

  console.log("\nHistory survives the template being deleted");
  await deleteTemplate(t.ownerActor, leaflet.id);
  const afterDelete = await listMessagesForActor(t.ownerActor);
  check(
    "the sent message still names the template",
    afterDelete.some((message) => message.templateName === "Care leaflet"),
  );
  check(
    "and the template itself is gone",
    (await listTemplatesForActor(t.ownerActor)).every(
      (template) => template.name !== "Care leaflet",
    ),
  );

  console.log("\nA number with no WhatsApp account is never messaged");
  await startNextDay(t.tenantId);
  calls.length = 0;
  notOnWhatsapp.add("919800000001");
  const absent = await sendToPatients(t.ownerActor, {
    templateId: reminder.id,
    patientIds: [t.ramesh],
  });
  check("it is reported as failed", absent.failed === 1, absent);
  check(
    "with a reason the front desk can act on",
    absent.results[0].failureReason?.includes("not on WhatsApp") === true,
    absent.results[0],
  );
  check(
    "and no send was attempted",
    calls.length === 1 && calls[0].path.endsWith("/check-number"),
    calls.map((call) => call.path),
  );
  notOnWhatsapp.delete("919800000001");

  // The production duplicate: a long bulk request outlives the proxy timeout,
  // the user presses Send again, and both requests work through the same list
  // — possibly on different app instances. Only the database lock is shared.
  console.log("\nOverlapping bulk sends never message anyone twice");
  await startNextDay(t.tenantId);
  calls.length = 0;
  const overlap = { templateId: reminder.id, patientIds: [t.ramesh, t.priya] };
  const [firstRun, secondRun] = await Promise.all([
    sendToPatients(t.ownerActor, overlap),
    sendToPatients(t.ownerActor, overlap),
  ]);
  check(
    "each patient was sent by exactly one of the two requests",
    firstRun.sent + secondRun.sent === 2 && firstRun.skipped + secondRun.skipped === 2,
    [firstRun, secondRun],
  );
  check(
    "the gateway saw one send per patient",
    calls.filter((call) => call.path.endsWith("/send-message")).length === 2,
    calls.map((call) => call.path),
  );
  check(
    "no row is left in flight",
    (await listMessagesForActor(t.ownerActor)).every(
      (message) => message.status !== IN_FLIGHT_STATUS,
    ),
  );

  console.log("\nDevice status drives the warning on the Messages page");
  const { getDeviceStatus, checkNumber } = await import("@/lib/whatsapp");
  const online = await getDeviceStatus();
  check("a connected device reports connected", online.ok && online.device.connected);
  check(
    "and its registered webhook comes back",
    online.ok && online.device.webhookUrl === null,
    online,
  );
  deviceStatus = "Disconnect";
  const offline = await getDeviceStatus();
  check("a disconnected one does not", offline.ok && !offline.device.connected, offline);
  check(
    "and its own wording is kept for display",
    offline.ok && offline.device.status === "Disconnect",
  );
  deviceStatus = "Connected";

  console.log("\ncheck-number: the LIVE boolean shape, not just the documented one");
  // The live API answers {"status":true,"msg":true|false}; its docs show
  // {"msg":{"exists":true,…}}. Both must work — the boolean because it is what
  // actually comes back, the object so a correction to match the docs does not
  // silently turn the check back into a no-op.
  check(
    "a boolean true means on WhatsApp",
    await (async () => {
      const result = await checkNumber("919800000001");
      return result.checked && result.exists;
    })(),
  );
  notOnWhatsapp.add("919800000002");
  check(
    "a boolean false means not on WhatsApp — and IS conclusive",
    await (async () => {
      const result = await checkNumber("919800000002");
      return result.checked && !result.exists;
    })(),
  );
  notOnWhatsapp.delete("919800000002");
  checkNumberShape = "object";
  check(
    "the documented object shape still works",
    await (async () => {
      const result = await checkNumber("919800000001");
      return result.checked && result.exists;
    })(),
  );
  checkNumberShape = "unknown";
  check(
    "an unrecognised shape is inconclusive, never 'not on WhatsApp'",
    await (async () => {
      const result = await checkNumber("919800000001");
      return !result.checked && !result.exists;
    })(),
  );
  checkNumberShape = "boolean";

  console.log("\nConfiguration errors name what is missing");
  process.env.WHATSAPP_BSP_API_KEY = "";
  await expectThrows(
    "a missing api key refuses before any call",
    () => sendToPatients(t.ownerActor, { templateId: reminder.id, patientIds: [t.ramesh] }),
    (error) => error instanceof Error && error.name === "WhatsappNotConfiguredError",
  );
  process.env.WHATSAPP_BSP_API_KEY = "STUB_KEY";

  process.env.WHATSAPP_BSP_SENDER = "";
  await expectThrows(
    // The old default was "rotate", which silently fails on an account whose
    // devices are all Rotate OFF — which is how they arrive.
    "a missing sending device refuses too, rather than defaulting to rotate",
    () => sendToPatients(t.ownerActor, { templateId: reminder.id, patientIds: [t.ramesh] }),
    (error) =>
      error instanceof Error &&
      error.name === "WhatsappNotConfiguredError" &&
      error.message.includes("WHATSAPP_BSP_SENDER"),
  );
  process.env.WHATSAPP_BSP_SENDER = "919999999999";

  console.log("\nFR-9.2 webhook — token verified, never signature-free");
  const { verifyWebhookToken, parseDeliveryStatusEvent, timingSafeEqual } = await import(
    "@/lib/whatsapp"
  );
  const url = (token: string) => `https://app.test/api/whatsapp/webhook?token=${token}`;

  check(
    "the right token in the URL is accepted",
    verifyWebhookToken(url("stub-webhook-token"), new Headers()),
  );
  check(
    "a wrong token is refused",
    !verifyWebhookToken(url("nope"), new Headers()),
  );
  check(
    "so is no token at all",
    !verifyWebhookToken("https://app.test/api/whatsapp/webhook", new Headers()),
  );
  check(
    "a header carrying it also works",
    verifyWebhookToken(
      "https://app.test/api/whatsapp/webhook",
      new Headers({ "x-webhook-token": "stub-webhook-token" }),
    ),
  );
  check("comparison is length-safe", !timingSafeEqual("abc", "abcd"));

  process.env.WHATSAPP_WEBHOOK_TOKEN = "";
  check(
    "with no token configured it FAILS CLOSED, never open",
    !verifyWebhookToken(url("stub-webhook-token"), new Headers()) &&
      !verifyWebhookToken("https://app.test/api/whatsapp/webhook", new Headers()),
  );
  process.env.WHATSAPP_WEBHOOK_TOKEN = "stub-webhook-token";

  console.log("\nCallback payloads are validated, never guessed at");
  check(
    "the send-response shape is understood",
    parseDeliveryStatusEvent({ data: { key: { id: "3EB0ABC" }, status: "READ" } })[0]
      ?.providerMessageId === "3EB0ABC",
  );
  check(
    "so is the ack shape their channel send returns",
    parseDeliveryStatusEvent({ data: { tag: "ack", attrs: { id: "182xx.7666" } } })[0]
      ?.status === "ack",
  );
  check(
    "so is the flat RkvRobo shape",
    parseDeliveryStatusEvent({ event: "ack", message_id: "3EB0ABC", status: "read" })[0]
      ?.providerMessageId === "3EB0ABC" &&
      parseDeliveryStatusEvent({ event: "ack", message_id: "3EB0ABC", status: "read" })[0]
        ?.status === "read",
  );
  check("an unrecognised shape yields nothing", parseDeliveryStatusEvent({ foo: 1 }).length === 0);
  check("and so does junk", parseDeliveryStatusEvent("nonsense").length === 0);
  check(
    "an id-less event is dropped rather than half-written",
    parseDeliveryStatusEvent({ data: { key: {} } }).length === 0,
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    stub.close();

    const stale = await prisma.tenant.findMany({
      where: { businessName: TEST_TENANT_NAME },
      select: { id: true },
    });

    for (const { id } of stale) {
      await prisma.whatsappMessage.deleteMany({
        where: { clinic: { tenantId: id } },
      });
      await prisma.tenantWhatsappSettings.deleteMany({ where: { tenantId: id } });
      await prisma.whatsappDevice.deleteMany({ where: { tenantId: id } });
      await prisma.whatsappProviderAccount.deleteMany({ where: { tenantId: id } });
      await prisma.registration.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.patient.deleteMany({ where: { tenantId: id } });
      await prisma.doctor.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
