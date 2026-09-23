# Phase AI-3 — Structured Clinical Facts (PRD draft)

> **Status: DRAFT — awaiting product-owner approval.** No schema, migration, API
> or UI for AI-3 exists yet. `CLAUDE.md` forbids adding tables that are not in
> `docs/PRD.md`; this document proposes them for review. Nothing here is built
> until the open questions in §13 are answered and PRD §6.10 is approved.

## 1. Purpose

Turn a **clinician-reviewed** consultation transcript (AI-2) into evidence-linked
**candidate** clinical facts that the doctor explicitly accepts or dismisses.
Accepted facts become the trustworthy input for AI-4 (prescription
reconciliation). AI-3 is a documentation aid, not clinical decision support.

AI-3 must never:

- infer a diagnosis, recommend or change treatment, or prescribe;
- invent a fact, or turn a question into a fact ("Do you have chest pain?" is not "chest pain present");
- infer a negative from silence (no allergy discussion is not "no known allergies");
- silently resolve contradictions;
- write to patient master data, consultation notes or the prescription;
- accept any fact on the doctor's behalf (no automatic acceptance, no "Accept all" in v1).

## 2. Baseline this builds on (verified in code, 2026-09-23)

| Existing capability | Where | Used by AI-3 for |
|---|---|---|
| Immutable provider transcript + segments (DB triggers block update/delete) | `clinical_transcripts`, `clinical_transcript_segments` | Evidence anchors: segment `id` is a stable cuid |
| Append-only segment corrections with a supersedes chain | `transcript_corrections` | Effective (corrected) segment text |
| Speaker mapping (label immutable, type DOCTOR/PATIENT/CAREGIVER/OTHER/UNKNOWN) | `transcript_speaker_mappings` | Speaker role of each evidence segment |
| Transcript `version` (incremented on every correction/speaker change/review) and `reviewedAt` (cleared on change) | `clinical_transcripts` | Staleness detection |
| Review gate: all speakers confirmed, exactly one DOCTOR, at least one PATIENT | `reviewTranscript()` | Only reviewed transcripts are extractable |
| Provider abstraction `AiProvider.generateStructured` (Gemini), rate-limited `AiRun` metadata, audit log | `src/lib/ai/*` | Extraction calls, usage metering |
| Leased worker + HTTP cron trigger | AI-2 worker (`fix/clinical-audio-http-cron`) | Running long extractions outside a web request |

## 3. Prerequisite gaps in AI-2 (must ship first)

1. **No effective-transcript hash.** `sourceHash` covers only the raw provider
   output. Corrections and speaker types change what the doctor reviewed, but
   nothing fingerprints that state.
2. **Review is an overwritten column, not a record.** `reviewedAt` is cleared on
   any change, and review history survives only in the generic audit log. AI-3
   needs an immutable record of *exactly what* was reviewed.

**Proposed fix — `transcript_reviews` (append-only, DB-trigger enforced):**

| Field | Notes |
|---|---|
| `id`, `tenant_id`, `clinic_id`, `registration_id`, `transcript_id` | Scoping + FK (RESTRICT) |
| `transcript_version` | `clinical_transcripts.version` at review time |
| `effective_hash` | SHA-256 of canonical JSON: ordered segments → `{segmentId, ordinal, speakerLabel, speakerType, startMs, endMs, effectiveText, correctionId}` |
| `reviewed_by_user_id`, `reviewed_at` | Actor + time |

`reviewTranscript()` writes one row inside its existing transaction.
`clinical_transcripts.reviewedAt` stays for compatibility. A review is
**current** only while `transcript.version == transcript_version`.

## 4. End-to-end flow

```
Reviewed transcript (current transcript_review)
  → Doctor clicks "Extract facts" (explicit, per transcript)
  → Extraction run queued (idempotent; see §9)
  → Worker: sequential chunked Gemini calls → candidate JSON
  → Deterministic evidence validation (§7) drops invalid candidates
  → Valid candidates shown with evidence quotes + audio seek
  → Doctor Accepts / Dismisses each candidate (append-only reviews)
  → Accepted facts of the CURRENT review feed AI-4
```

Extraction runs in the existing leased worker (the HTTP cron pass gains an
extraction step). Chunked calls can exceed a web request's lifetime, and leases
and fencing already handle crashes and duplicate triggers. The UI shows
QUEUED/PROCESSING and polls.

## 5. Fact model

**Categories** (v1): `CHIEF_COMPLAINT`, `SYMPTOM`, `HISTORY`,
`PAST_MEDICAL_HISTORY`, `MEDICATION_MENTION`, `ALLERGY`, `EXAM_FINDING`,
`INVESTIGATION`, `MEASUREMENT`, `ASSESSMENT`, `DIAGNOSIS_MENTION`, `PLAN`,
`ADVICE`, `FOLLOW_UP`.

`DIAGNOSIS_MENTION` and `ASSESSMENT` record only what a speaker **said** ("the
doctor said this looks like a viral fever"). They never record an inference.

**Assertion:** `PRESENT`, `NEGATED`, `UNCERTAIN`, `HISTORICAL`, `CONDITIONAL`.
**Subject:** `PATIENT`, `FAMILY_MEMBER`, `OTHER`, `UNKNOWN`.

**Attributes** (bounded, category-specific, all **verbatim substrings** of evidence):
- `MEDICATION_MENTION`: `name`, `strength`, `dose`, `route`, `frequency`, `duration`
- `MEASUREMENT`: `name`, `value`, `unit`
- `SYMPTOM` / `CHIEF_COMPLAINT`: `duration`, `laterality`, `severity`
- `FOLLOW_UP`: `interval`

AI-3 stores what was said. Normalizing "BD" to "twice daily" is AI-4's
deterministic job.

## 6. Proposed tables

All tables carry `tenant_id` + `clinic_id`, and use RESTRICT foreign keys. Scoping
is derived from the session, never from client IDs (same pattern as AI-2).

**`clinical_fact_extraction_runs`**
`id, tenant_id, clinic_id, registration_id, transcript_id, transcript_review_id,
effective_hash, status (QUEUED|PROCESSING|COMPLETED|FAILED), failure_code,
provider, model, prompt_version, schema_version, chunk_count, candidate_count,
rejected_count, active_key (unique, nullable), idempotency_key (unique),
lease_token, lease_expires_at, requested_by_user_id, created_at, completed_at`

**`clinical_fact_candidates`** (immutable after insert)
`id, tenant_id, clinic_id, registration_id, extraction_run_id, category,
assertion, subject, statement (≤500 chars), attributes (JSON, bounded),
created_at`

**`clinical_fact_evidence`** (immutable)
`id, fact_id, segment_id, correction_id (nullable), speaker_type_at_extraction,
quote (≤300 chars), char_start, char_end`

**`clinical_fact_reviews`** (append-only; latest row per fact = current decision)
`id, tenant_id, fact_id, decision (ACCEPTED|DISMISSED), reason (nullable, ≤500),
reviewed_by_user_id, reviewed_at`

Candidate and evidence text are clinical data. They live only in these tables, never
in `ai_runs`, generic audit payloads or logs (same rule as AI-2).

## 7. Deterministic evidence validation (MedCare is the authority, not Gemini)

A candidate is **discarded** (counted in `rejected_count`, never shown) unless all
of these hold:

1. Every `segment_id` belongs to the run's transcript, and `quote` is an exact
   substring of that segment's **effective** text at the reviewed version
   (`char_start/char_end` must match).
2. Every number, unit and laterality term in `statement` and `attributes`
   appears in the evidence quotes. Attribute values must be verbatim substrings.
3. **Questions are not facts.** If all evidence comes from DOCTOR segments and the
   quoted sentence ends in `?`, the assertion must not be `PRESENT`/`NEGATED`.
   A fact needs an answering PATIENT/CAREGIVER segment as evidence.
4. **No negatives from silence.** A `NEGATED` assertion requires a negation cue
   (no, not, denies, never, without, none, nil, and the curated Hindi/Hinglish cues
   `nahi`, `nahin`, `mat`) inside the quote.
5. `subject = PATIENT` requires at least one evidence segment spoken by PATIENT or
   CAREGIVER, or a DOCTOR quote explicitly about the patient.
6. Category/attribute shape matches the schema; lengths are bounded.

The validator also runs, in advance, the safety cases that apply to it from the
AI-1 anchor tests (numbers, negation, laterality).

**Contradictions are preserved.** Candidates with the same category, subject and
normalized statement but opposing assertions (e.g. NEGATED "fever", then PRESENT
"fever yesterday") are both kept and flagged **Conflicting** in the UI. Neither
is auto-dismissed.

## 8. Staleness

- A run is **stale** when its `transcript_review_id` is no longer the transcript's
  current review (derived at read time, never a stored flag that can drift).
- Stale runs and their facts stay visible (read-only, labelled **Stale**) for
  history. They can't be accepted and are never returned to AI-4.
- Re-extraction after a new review creates a new run. Earlier decisions are not
  copied forward automatically, because the evidence may have changed.

## 9. Idempotency and cost control

- `idempotency_key = sha256(transcript_review_id + prompt_version + schema_version)`,
  unique. A double-click or browser retry returns the existing run and never
  pays for a second provider call.
- `active_key = transcript_id`, unique while QUEUED/PROCESSING: one in-flight run
  per transcript.
- Existing `AiRun` rate reservations meter every provider call. Bounded retries
  (≤3, backoff) apply only to transient provider failures.

## 10. Long transcripts

Chunk **sequentially by segment**, on segment boundaries (~6k input tokens per
chunk, 2-segment overlap), keeping original segment IDs. Merge candidates
deterministically: identical category, subject, assertion and normalized
statement with overlapping evidence are combined. **Never summarize first and
extract from the summary**, because a summary destroys evidence linkage.

## 11. Security, privacy and RBAC

| Control | Proposal |
|---|---|
| Runtime kill switch | `CLINICAL_FACTS_ENABLED` (plus existing `AI_ENABLED`) |
| Module | existing `clinical_ai` (see open question Q2) |
| Permissions (new, least privilege) | `clinical-ai:facts-extract` (request extraction), `clinical-ai:facts-review` (accept/dismiss); viewing reuses `clinical-ai:transcript-read` |
| Actor | Linked assigned Doctor of the visit, as in AI-1/AI-2; wildcards never impersonate a doctor |
| Scope | tenant + clinic + registration, derived server-side; foreign IDs → privacy-safe 404 |
| Provider input minimization | Only segment IDs, speaker roles and segment text; no patient name, phone, IDs or clinic identity |
| Logging | Metadata only (counts, status, latency, model); no transcript, quote or fact text |

## 12. Acceptance criteria

- Extraction is impossible without a **current** `transcript_review`.
- Every shown candidate passes §7. A synthetic hallucination suite (invented
  quote, wrong segment, changed number, question-as-fact, silence-as-negative)
  produces **zero** shown candidates.
- Accept/Dismiss writes append-only reviews. There's no bulk accept, and no
  consultation note, patient record or prescription is modified.
- Correcting the transcript after extraction marks the run Stale, and the accepted
  facts disappear from the AI-4 input.
- Double-submit creates exactly one run and at most one provider call per chunk.
- Cross-tenant, cross-clinic and unassigned-doctor access are denied, with tests.
- No clinical text appears in `ai_runs`, audit payloads or application logs.
- Test layers: unit (validator, chunk merge, hash), DB integration (triggers,
  idempotency, staleness), Playwright E2E (extract → review → stale), and a
  synthetic live-provider QA report before release.

## 13. Open questions for approval

- **Q1.** Approve the four AI-3 tables plus `transcript_reviews` for PRD §7?
- **Q2.** Should AI-3 sit under the existing `clinical_ai` module, or have its own
  sellable feature key (`clinical_ai_facts`)? The same question applies to recording.
- **Q3.** Should v1 include all 14 categories, or start with the 8 that AI-4 needs
  (`SYMPTOM`, `MEDICATION_MENTION`, `ALLERGY`, `MEASUREMENT`, `DIAGNOSIS_MENTION`,
  `INVESTIGATION`, `ADVICE`, `FOLLOW_UP`)?
- **Q4.** Which consultation languages must v1 support? This determines the
  negation-cue lists in §7.4. Romanized views are never used as evidence; the
  source transcript is.
- **Q5.** Should accepted facts later pre-fill consultation fields on explicit
  doctor action, or remain AI-4 input only? (Recommended: AI-4 input only for v1.)

## 14. Out of scope

AI-4 reconciliation, AI-5 compliance checks, the allergy master data model,
drug normalization, auto-populating notes or prescriptions, and multi-visit
patient fact history.
