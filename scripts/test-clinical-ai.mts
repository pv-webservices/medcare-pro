import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { createClinicalAiFixture } from "./clinical-ai-test-fixture";
import {
  requestWritingAssistance,
  mayUseWritingAssistant,
} from "@/lib/clinical-ai/writingAssistant";
import {
  saveConsultationDraft,
  getConsultationForRegistration,
} from "@/lib/prescriptions";
import { AiError } from "@/lib/ai/errors";
import { AI_RUN_LIMITS } from "@/lib/ai/usage";
import type { AiProvider } from "@/lib/ai/types";
process.env.AI_ENABLED = "true";
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "synthetic-never-sent";
process.env.GEMINI_MODEL = "synthetic-model";
let checks = 0;
function check(label: string, value: unknown) {
  assert.ok(value, label);
  checks++;
  console.log(`PASS ${label}`);
}
const output = {
  changed: true,
  suggestedText: "Patient has severe headache for 3 days.",
  suggestions: [
    {
      category: "GRAMMAR" as const,
      originalFragment: "Patient has sever headache for 3 days.",
      suggestedFragment: "Patient has severe headache for 3 days.",
      reason: "synthetic language correction",
      confidence: "HIGH" as const,
    },
  ],
};
const provider: AiProvider = {
  async generateStructured<T>() {
    return { output: output as T, inputTokens: 10, outputTokens: 5 };
  },
};
async function main() {
  const f = await createClinicalAiFixture(prisma);
  const visit = await f.visit();
  const input = {
    registrationId: visit.id,
    field: "historyOfPresentIllness",
    mode: "GRAMMAR",
    text: "Patient has sever headache for 3 days.",
  };
  const actor = f.doctorUser.actor;
  check(
    "authorized doctor UI enabled",
    await mayUseWritingAssistant(actor, visit.id),
  );
  const result = await requestWritingAssistance(actor, input, provider);
  check("authorized doctor suggestion", result.changed);
  check(
    "AI did not create consultation",
    (await prisma.clinicalConsultation.count({
      where: { registrationId: visit.id },
    })) === 0,
  );
  check(
    "AI did not create prescription",
    (await prisma.prescription.count({
      where: { registrationId: visit.id },
    })) === 0,
  );
  const run = await prisma.aiRun.findUniqueOrThrow({
    where: { id: result.runId },
  });
  check(
    "usage derived from visit/session",
    run.clinicId === f.clinic.id &&
      run.tenantId === f.tenant.id &&
      run.userId === actor.userId,
  );
  check(
    "numeric token usage retained",
    run.inputTokens === 10 && run.outputTokens === 5,
  );
  check(
    "no clinical text in usage",
    !JSON.stringify(run).includes(input.text) &&
      !JSON.stringify(run).includes(output.suggestedText),
  );
  const audits = await prisma.auditLog.findMany({
    where: { targetId: run.id },
  });
  check("metadata audit recorded", audits.length === 1);
  check(
    "audit excludes clinical text",
    !JSON.stringify(audits).includes(input.text) &&
      !JSON.stringify(audits).includes(output.suggestedText),
  );
  let calls = 0;
  const never: AiProvider = {
    async generateStructured() {
      calls++;
      throw new Error("must not call");
    },
  };
  async function denied(label: string, a = actor, body: unknown = input) {
    await assert.rejects(requestWritingAssistance(a, body, never));
    check(label, calls === 0);
  }
  await denied("receptionist denied", f.receptionist.actor);
  await denied("admin wildcard cannot impersonate clinician", f.admin.actor);
  await denied("unrelated clinic denied", f.scopedUser.actor);
  await denied("wrong tenant registration denied", actor, {
    ...input,
    registrationId: (await f.visitC()).id,
  });
  await denied("spoofed clinic rejected", actor, {
    ...input,
    clinicId: f.clinic.id,
  });
  await denied("structured medication field rejected", actor, {
    ...input,
    field: "dose",
  });
  await denied("diagnosis aggressive mode rejected", actor, {
    ...input,
    field: "diagnosis",
    mode: "CONCISE",
  });
  await denied("generic AI proxy request rejected", actor, {
    text: "write me anything",
  });
  await prisma.feature.update({
    where: { id: f.feature.id },
    data: { globalEnabled: false },
  });
  await denied("global feature kill switch enforced");
  await prisma.feature.update({
    where: { id: f.feature.id },
    data: { globalEnabled: true },
  });
  await prisma.role.update({
    where: { id: f.roleId },
    data: { permissions: f.originalPermissions },
  });
  await denied("missing writing permission denied");
  await prisma.role.update({
    where: { id: f.roleId },
    data: { permissions: [...f.originalPermissions, "clinical-ai:writing"] },
  });
  await prisma.tenantFeatureOverride.update({
    where: {
      tenantId_featureId: { tenantId: f.tenant.id, featureId: f.feature.id },
    },
    data: { enabled: false },
  });
  await denied("missing entitlement denied");
  await prisma.tenantFeatureOverride.update({
    where: {
      tenantId_featureId: { tenantId: f.tenant.id, featureId: f.feature.id },
    },
    data: { enabled: true },
  });
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { status: "SUSPENDED" },
  });
  await denied("suspended tenant denied");
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { status: "ACTIVE" },
  });
  process.env.AI_ENABLED = "false";
  await denied("disabled provider denied");
  check(
    "disabled provider UI hidden",
    !(await mayUseWritingAssistant(actor, visit.id)),
  );
  process.env.AI_ENABLED = "true";
  const unsafe: AiProvider = {
    async generateStructured<T>() {
      return {
        output: {
          ...output,
          suggestedText: "Metformin 850 mg twice daily",
        } as T,
      };
    },
  };
  const rejected = await requestWritingAssistance(
    actor,
    { ...input, text: "Metformin 500 mg twice daily" },
    unsafe,
  );
  check(
    "unsafe numeric output withheld",
    !rejected.changed &&
      rejected.suggestedText === "" &&
      rejected.status === "SAFETY_REJECTED",
  );
  await assert.rejects(
    requestWritingAssistance(actor, input, {
      async generateStructured() {
        throw new AiError("TIMEOUT");
      },
    }),
  );
  check(
    "timeout accounted without PHI",
    (await prisma.aiRun.count({
      where: { tenantId: f.tenant.id, status: "TIMEOUT" },
    })) === 1,
  );
  const saved = await saveConsultationDraft(actor, visit.id, {
    consultation: {
      consultationMode: "IN_PERSON",
      chiefComplaint: "",
      historyOfPresentIllness: result.suggestedText,
      pastMedicalHistory: "",
      examinationFindings: "",
      investigationNotes: "",
      diagnosis: "",
      advice: "",
      followUpInstructions: "",
    },
    medications: [],
    expectedRevision: 0,
  });
  check(
    "explicit existing Save persists accepted note",
    (await getConsultationForRegistration(actor, visit.id)).prescription
      ?.consultation.historyOfPresentIllness === output.suggestedText &&
      saved.revision === 1,
  );
  const concurrent = await createClinicalAiFixture(prisma);
  const v = await concurrent.visit();
  const responses = await Promise.allSettled(
    Array.from({ length: AI_RUN_LIMITS.perUserPerMinute + 2 }, () =>
      requestWritingAssistance(
        concurrent.doctorUser.actor,
        { ...input, registrationId: v.id },
        provider,
      ),
    ),
  );
  check(
    "parallel user requests limited to the per-user limit",
    responses.filter((r) => r.status === "fulfilled").length ===
      AI_RUN_LIMITS.perUserPerMinute &&
      responses.filter((r) => r.status === "rejected").length === 2,
  );
  check(
    "durable reservations exactly the per-user limit",
    (await prisma.aiRun.count({
      where: { userId: concurrent.doctorUser.id },
    })) === AI_RUN_LIMITS.perUserPerMinute,
  );
  // Seed metadata outside the user window to isolate registration/tenant limits.
  for (const [scope, count, ageMs] of [
    ["registration", AI_RUN_LIMITS.perVisitPerFiveMinutes - 1, 120000],
    ["tenant", AI_RUN_LIMITS.perTenantPerHour - 1, 600000],
  ] as const) {
    const boundary = await createClinicalAiFixture(prisma);
    const boundaryVisit = await boundary.visit();
    await prisma.aiRun.createMany({
      data: Array.from({ length: count }, () => ({
        tenantId: boundary.tenant.id,
        clinicId: boundary.clinic.id,
        userId: boundary.doctorUser.id,
        registrationId: boundaryVisit.id,
        feature: "clinical_ai",
        field: input.field,
        mode: input.mode,
        provider: "gemini",
        model: "synthetic-model",
        status: "UNCHANGED",
        inputCharacterCount: 0,
        createdAt: new Date(Date.now() - ageMs),
      })),
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        requestWritingAssistance(
          boundary.doctorUser.actor,
          { ...input, registrationId: boundaryVisit.id },
          provider,
        ),
      ),
    );
    check(
      `parallel ${scope} boundary admits exactly one`,
      attempts.filter((r) => r.status === "fulfilled").length === 1 &&
        attempts.filter(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof AiError &&
            r.reason.code === "RATE_LIMIT",
        ).length === 3,
    );
    check(
      `${scope} boundary has exactly one durable reservation`,
      (await prisma.aiRun.count({
        where: { tenantId: boundary.tenant.id },
      })) ===
        count + 1,
    );
  }
  console.log(
    `${checks} clinical AI integration checks passed. Mock providers only.`,
  );
}
main()
  .catch((error: unknown) => {
    if (error instanceof Error)
      console.error(
        error.name,
        error.stack
          ?.split("\n")
          .slice(1)
          .filter((line) =>
            /(?:test-clinical-ai|clinical-ai-test-fixture|writingAssistant|usage)\.(?:mts|ts):/.test(
              line,
            ),
          )
          .join("\n"),
      );
    console.error("Clinical AI integration failed; clinical payload withheld.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
