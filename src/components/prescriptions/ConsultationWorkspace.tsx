"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import MedicationBuilder from "@/components/prescriptions/MedicationBuilder";
import PrescriptionDocument from "@/components/prescriptions/PrescriptionDocument";
import {
  consultationSchema,
  prescriptionDraftSchema,
  issuedContentSchema,
  CLINICAL_FIELDS,
  type PrescriptionSnapshot,
} from "@/lib/prescriptionValidation";
import type { ConsultationWorkspaceData } from "@/lib/prescriptions";

export default function ConsultationWorkspace({
  data,
}: {
  data: ConsultationWorkspaceData;
}) {
  const router = useRouter();
  const [consultation, setConsultation] = useState(
    data.prescription?.consultation ?? consultationSchema.parse({}),
  );
  const [medications, setMedications] = useState(
    data.prescription?.medications ?? [],
  );
  const [revision, setRevision] = useState(data.prescription?.revision ?? 0);
  const [id, setId] = useState(data.prescription?.id ?? null);
  const [review, setReview] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const { context } = data;
  if (data.prescription && data.prescription.status !== "DRAFT")
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Consultation finalized</h1>
        <Link
          className="text-accent underline"
          href={`/prescriptions/${data.prescription.id}`}
        >
          View prescription
        </Link>
      </div>
    );
  const draftInput = { consultation, medications, expectedRevision: revision };
  async function request(url: string, payload: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as {
      success: boolean;
      error?: string;
      data?: { id: string; revision?: number };
    };
    if (!response.ok || !body.success || !body.data)
      throw new Error(body.error || "Could not save the prescription.");
    return body.data;
  }
  async function save(nextReview = false) {
    const checked = (
      nextReview ? issuedContentSchema : prescriptionDraftSchema
    ).safeParse(draftInput);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(
          checked.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );
      setMessage(checked.error.issues[0]?.message || "Check the form.");
      return;
    }
    setBusy(true);
    setMessage("");
    setErrors({});
    try {
      const saved = await request(
        `/api/registrations/${context.visit.registrationId}/consultation`,
        checked.data,
      );
      setId(saved.id);
      setRevision(saved.revision ?? revision);
      setDirty(false);
      setReview(nextReview);
      setMessage(nextReview ? "Review the saved draft below." : "Draft saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    if (!id) return;
    setBusy(true);
    setMessage("");
    try {
      await request(`/api/prescriptions/${id}/issue`, {
        expectedRevision: revision,
      });
      router.push(`/prescriptions/${id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not issue.");
      setConfirmIssue(false);
    } finally {
      setBusy(false);
    }
  }
  const preview: PrescriptionSnapshot | null = context.doctor
    ? {
        schemaVersion: 1,
        prescriptionNumber: "DRAFT",
        issuedAt: new Date().toISOString(),
        ...context,
        doctor: {
          ...context.doctor,
          qualification: context.doctor.qualification || "Not recorded",
          medicalRegistrationNumber:
            context.doctor.medicalRegistrationNumber || "Not recorded",
          registrationCouncil:
            context.doctor.registrationCouncil || "Not recorded",
        },
        consultation,
        medications,
      }
    : null;
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/registration/${context.visit.registrationId}`}
            className="text-label text-accent"
          >
            ← Patient visit
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-ink">
            {review ? "Review prescription" : "Clinical consultation"}
          </h1>
          <p className="text-muted">
            Draft · Version {data.prescription?.version ?? 1} ·{" "}
            {dirty ? "Unsaved changes" : "Saved work"}
          </p>
        </div>
      </header>
      <div className="rounded-2xl border border-line bg-canvas p-5">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {context.patient.name}
            </h2>
            <p className="text-muted">
              {context.patient.patientCode} ·{" "}
              {context.patient.age ?? "Age not recorded"} ·{" "}
              {context.patient.gender || "Gender not recorded"}
            </p>
          </div>
          <div>
            <p className="font-semibold">
              {context.doctor?.name || "No assigned doctor"}
            </p>
            <p className="text-muted">
              {context.clinic.name} · {context.visit.department}
            </p>
          </div>
        </div>
        <p className="mt-3 text-label text-muted">
          Visit {context.visit.visitDate.slice(0, 10)}{" "}
          {context.visit.visitDate.slice(11, 16)} ·{" "}
          {context.patient.mobileNumber}
        </p>
      </div>
      {!context.doctor && (
        <p role="alert" className="text-alert-ink">
          Assign a doctor to this visit before starting a consultation.
        </p>
      )}
      {context.doctor &&
        (!context.doctor.qualification ||
          !context.doctor.medicalRegistrationNumber ||
          !context.doctor.registrationCouncil) && (
          <p className="rounded-xl border border-warn-line bg-warn-bg p-4 text-warn-ink">
            Complete the assigned Doctor&apos;s qualification, registration
            number and council before issuance. Drafts can still be saved.
          </p>
        )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-line bg-canvas p-4"
        >
          {message}
        </p>
      )}
      {review && preview ? (
        <>
          <PrescriptionDocument
            snapshot={preview}
            draft
            version={data.prescription?.version ?? 1}
          />
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setReview(false);
                setConfirmIssue(false);
              }}
            >
              Back to edit
            </Button>
            {data.mayIssue && (
              <Button disabled={busy} onClick={() => setConfirmIssue(true)}>
                Issue prescription
              </Button>
            )}
          </div>
          <Modal
            isOpen={confirmIssue}
            onClose={() => setConfirmIssue(false)}
            isBusy={busy}
            title="Confirm clinical issuance"
            description="Issuance permanently freezes this document. Corrections require a new version."
            footer={
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmIssue(false)}
                >
                  Keep as draft
                </Button>
                <Button
                  variant="primary"
                  isBusy={busy}
                  busyLabel="Issuing…"
                  onClick={issue}
                >
                  Confirm and issue
                </Button>
              </>
            }
          >
            <p>I have reviewed the patient, clinical notes and medications.</p>
          </Modal>
          {!data.mayIssue && (
            <p className="text-muted">
              Only the linked assigned Doctor with issue permission may finalize
              this draft.
            </p>
          )}
        </>
      ) : (
        <fieldset
          disabled={busy || !data.mayDraft || !context.doctor}
          className="space-y-5"
        >
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-line bg-canvas p-5">
              <h2 className="text-lg font-semibold">Consultation notes</h2>
              <Select
                id="consultation-mode"
                label="Consultation mode"
                value={consultation.consultationMode}
                onChange={(e) => {
                  setConsultation({
                    ...consultation,
                    consultationMode: e.target
                      .value as typeof consultation.consultationMode,
                  });
                  setDirty(true);
                }}
              >
                {["IN_PERSON", "VIDEO", "AUDIO", "TEXT"].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
              {CLINICAL_FIELDS.map(([key, label, maxLength]) => (
                <Textarea
                  key={key}
                  id={`consultation-${key}`}
                  label={label}
                  rows={key === "diagnosis" || key === "chiefComplaint" ? 3 : 2}
                  maxLength={maxLength}
                  value={consultation[key]}
                  error={errors[`consultation.${key}`]}
                  onChange={(e) => {
                    setConsultation({ ...consultation, [key]: e.target.value });
                    setDirty(true);
                  }}
                />
              ))}
            </div>
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                Prescription medications
              </h2>
              <MedicationBuilder
                items={medications}
                errors={errors}
                onChange={(items) => {
                  setMedications(items);
                  setDirty(true);
                }}
              />
            </div>
          </div>
          <div className="sticky bottom-0 flex flex-wrap gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card">
            <Button
              variant="secondary"
              onClick={() => save(false)}
              disabled={busy}
            >
              Save draft
            </Button>
            <Button onClick={() => save(true)} disabled={busy}>
              Review prescription
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
