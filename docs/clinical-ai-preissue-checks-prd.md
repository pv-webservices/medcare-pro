# Phase AI-5 — Pre-issue Prescription Checks (PRD)

> **Status: APPROVED (§12 decided 2026-09-27) — v1 built, off by default.**
> No tables or migrations. Code: `src/lib/prescription-checks/*` (rules version
> `ai5-rules-v1`), `getPreIssueChecks()` and issue-time enforcement in
> `src/lib/prescriptions.ts`, route `GET /api/prescriptions/:id/pre-issue-checks`,
> and `PreIssueChecksPanel` on the Review step. Enable with
> `PRESCRIPTION_CHECKS_ENABLED=true` **only after** the named clinician signs off
> §5.2 and §5.3 (Q5). Implements PRD FR-10.5 (v1 scope only, see §1).

## 1. Purpose

When a doctor reaches **Review prescription**, show a short list of things
worth a second look **before** they issue: internal inconsistencies in the
draft itself, an accepted allergy that names a prescribed medicine, and
consultation audio that has not been reviewed yet. Every item is a warning. The
doctor decides, and can always issue.

v1 is deliberately limited to checks that are **arithmetic or lookup facts about
the draft itself**. None of them needs a drug master, dosing knowledge or a
legal ruleset, so v1 makes **no clinical-safety or regulatory compliance claim**.

AI-5 v1 must never:

- block or delay issuing (the existing hard rules in `issuedContentSchema` and
  the doctor-credential check stay exactly as they are, and are not AI-5);
- change a prescription item, note or patient record;
- recommend a drug, dose, alternative or quantity;
- call an AI provider (FR-10.5's optional AI warnings are deferred, see Q1);
- present "no warnings" as "safe", "correct" or "compliant".

## 2. Baseline (verified in code, 2026-09-27)

| Existing capability | Where | Used by AI-5 for |
|---|---|---|
| Hard issue rules: diagnosis; ≥1 medicine; generic name, form, dose, route, frequency, duration per medicine | `issuedContentSchema` (`src/lib/prescriptionValidation.ts`) | Unchanged. AI-5 only runs on drafts that pass them |
| Doctor qualification, registration number and council required to issue | `src/lib/prescriptions.ts` | Unchanged, out of AI-5 scope |
| Fixed option lists for dosage form, route, frequency, timing, duration unit | `MEDICATION_OPTIONS` | Form↔route table (§5.2), quantity arithmetic (§5.3) |
| Optional fields not required to issue: `strength`, `quantity`, `timing`, `instructions`, `followUpInstructions` | `medicationSchema`, `consultationSchema` | Completeness warnings |
| Drug-name, strength, frequency and duration normalizers (`ai4-rules-v1`) | `src/lib/clinical-reconciliation/normalize.ts` (AI-4) | Reused as-is. Only the English entries matter here, because v1 reads the fixed option-list values |
| Accepted, non-stale AI-3 facts with evidence | `getAcceptedTranscriptFacts()` | Allergy name check (§6, PC-07) |
| Transcription run status and transcript review snapshots | `transcription_runs`, `transcript_reviews` | Unreviewed-audio warning (§6, PC-08) |
| Audit log (append-only) | `writeAuditLog()` | Recording which check codes were shown at issue (Q3) |

**Not available, and not built by AI-5 v1:** a drug master or brand→generic
map, drug classes, interactions, dose ranges, patient weight, renal/hepatic
status, pregnancy status, a patient allergy record, and scheduled-drug
(H/H1/X) or prescription-format rules.

## 3. Flow

```
Doctor clicks "Review prescription"  (draft is saved first, as today)
  → Client requests checks for the SAVED draft revision
  → Server loads the draft, recomputes checks (§5, §6), rules version pinned
  → "Before you issue" panel above the Issue button:
       Warnings (count), each naming the medicine row and what to look at
  → Doctor fixes (Back to edit) or proceeds; Issue stays enabled (see Q2)
  → On issue, the server recomputes and records the check CODES shown (Q3)
```

Checks run on the saved revision, not on unsaved editor state, so what the
doctor saw is exactly what is issued. They are recomputed on every request and
never stored. The only persistence is the optional audit entry (Q3).

## 4. Inputs and eligibility

| Input | Source | Notes |
|---|---|---|
| Draft medicines and consultation | Saved `DRAFT` prescription at `expectedRevision` | Stale revision → 409, same as issue |
| Accepted allergy facts | AI-3, current transcript reviews of the visit | Only when `CLINICAL_FACTS_ENABLED`, else PC-07 is skipped (and the panel says so) |
| Recording/transcription state | The visit's READY recordings, latest run, transcripts, reviews (counts only) | Only when clinical audio is enabled |
| Actor | Any user who can read the draft and holds `prescription:draft` on its clinic; issuing still requires the linked assigned Doctor with `prescription:issue` | PC-07 needs the AI-3 transcript permissions; without them it is reported as skipped |

## 5. Deterministic rules (rules version `ai5-rules-v1`)

### 5.1 Name normalization

Reuse `normalizeDrugName()` from AI-4 unchanged: form words and strengths
removed, case-folded, **never fuzzy**. Two different names are never treated as
the same medicine.

### 5.2 Dosage form ↔ route (only the fixed option values)

A pair outside this table is a warning. `Other` on either side, or a value not
in `MEDICATION_OPTIONS`, is not checked.

| Dosage form | Expected routes |
|---|---|
| Tablet, Capsule | Oral, Sublingual |
| Syrup, Suspension | Oral |
| Powder | Oral, Topical |
| Injection | Intramuscular, Intravenous, Subcutaneous |
| Cream, Ointment, Gel, Lotion | Topical |
| Drops | Oral, Ophthalmic, Otic, Nasal |
| Inhaler | Inhalation, Nasal |

*Clinical content: needs named-clinician sign-off (Q5).*

### 5.3 Quantity arithmetic

Expected quantity = units per dose × doses per day × days. It is only computed
when **all three** parts are unambiguous:

- **units per dose:** `dose` is a whole number or ½, followed by that row's
  dosage-form word (`1 tablet`, `2 capsules`, `½ tablet`). Doses in mg/ml/drops
  are never converted.
- **doses per day:** a fixed-count frequency (Once/Twice/Three/Four times daily,
  every 4/6/8/12 hours, At bedtime). `As needed` and `Weekly` are skipped.
- **days:** `draftDurationDays()` (days/weeks/months, 30-day month).

The check applies only to Tablet and Capsule rows with a `quantity` entered. It
warns when the entered quantity is **less than** the expected quantity. More
than expected is not flagged, because rounding up to a strip size is normal.

## 6. Checks (v1)

| Code | When | Message (example) |
|---|---|---|
| PC-01 DUPLICATE_MEDICINE | Two rows share a normalized generic **or** brand name | "Paracetamol appears in rows 1 and 3." |
| PC-02 FORM_ROUTE_MISMATCH | §5.2 | "Row 2: Tablet with route Intravenous." |
| PC-03 STRENGTH_NOT_RECORDED | `strength` empty, or a bare number with no unit (`normalizeStrength` finds none) | "Row 1: strength not recorded." / "Row 1: strength '500' has no unit." |
| PC-04 QUANTITY_SHORT | §5.3 | "Row 2: 1 tablet × 3 a day × 5 days = 15, quantity is 10." |
| PC-05 PRN_WITHOUT_GUIDANCE | Frequency `As needed` and `instructions` empty | "Row 4: 'As needed' without instructions (when, and how often at most)." |
| PC-06 FOLLOW_UP_NOT_RECORDED | `followUpInstructions` empty | "No follow-up instructions." |
| PC-07 ALLERGY_NAME_ON_PRESCRIPTION | An accepted, non-stale AI-3 allergy fact's substance equals a row's normalized generic or brand name (AI-4 rule; **name match only**, no class cross-reactivity) | "Accepted allergy 'penicillin' (said at 1:23) matches row 2." |
| PC-08 CONSULTATION_AUDIO_UNREVIEWED | A READY recording whose transcription is still running, that was never transcribed (audio still retained), or whose transcript has no review of its current version | "Consultation recordings: 1 still processing, 2 not reviewed. Facts can't be extracted after issue." |

**Tiers (Q2/Q4):** PC-07, PC-01 and PC-02 are **Review required**. The doctor
ticks one acknowledgement in the issue confirmation, and the server refuses
`issue` without it (409). The rest are **Consider**: shown, never interrupting.
Neither tier blocks issuing. Ordering: PC-07, PC-01, PC-02, PC-04, PC-08, PC-03,
PC-05, PC-06.

PC-08 addresses what happened on 2026-09-26, when a prescription was issued
while transcription was queued and the AI-3 facts could no longer be used.

## 7. API contract

`GET /api/prescriptions/:id/pre-issue-checks?expectedRevision=N`

```json
{
  "success": true,
  "data": {
    "rulesVersion": "ai5-rules-v1",
    "revision": 7,
    "checks": [
      { "code": "PC-04", "tier": "CONSIDER", "items": [1], "message": "Row 2: 1 tablet × 3 a day × 5 days = 15, quantity is 10." }
    ],
    "skipped": ["PC-07"]
  }
}
```

- 404/403 on scope or permission failure, the same as reading the draft; 409 when
  the revision changed; 404 when AI-5 is disabled (kill switch).
- `POST /api/prescriptions/:id/issue` accepts `acknowledgedChecks` (default
  `false`). With the switch on, the server recomputes the checks for the issued
  revision and returns 409 if a Review-required check exists and it is `false`.
- `skipped` lists checks that could not run (facts or audio disabled for the
  visit), so an empty `checks` array is never ambiguous.
- Read-only: no rows written. `Cache-Control: private, no-store`.

## 8. Security, privacy, RBAC

- Same scope chain as issuing: tenant, clinic, linked assigned Doctor, draft
  status, `prescriptions` module. No new permission (Q6).
- Messages contain draft values and allergy quotes. They are returned only to
  the authorized doctor and **never logged**. The optional audit entry (Q3)
  stores check **codes and counts only**, never names, doses or quotes.
- Kill switch `PRESCRIPTION_CHECKS_ENABLED` (default `false`). When off, the
  panel is absent and the route returns 404. Issuing is unaffected either way.

## 9. UI

- **Review step:** a "Before you issue" panel above **Issue prescription**, with
  "N things to check" and one line per check linking to the row (Back to edit).
- With zero checks: "No issues found by these checks", plus a link listing what
  was checked. It never says "safe" or "compliant".
- **Confirmation modal:** repeats the count. When a Review-required check exists,
  "Confirm and issue" stays disabled until "I have reviewed the pre-issue checks
  marked review required" is ticked. If the server finds checks the panel did not
  show (refused issue), the panel reloads.
- Follows `admin-dashboard-ui` tokens. Accessible: role="status" count, list
  semantics, 44px targets.

## 10. Acceptance criteria

1. Every check in §6 has unit tests covering the trigger, a near-miss that does
   not trigger, and the skip case (`Other`, unparseable dose, PRN, facts off).
2. A draft passing today's issue rules can always be issued with AI-5 on,
   whatever the warnings (integration test).
3. Stale revision → 409. Foreign tenant, non-assigned doctor and front desk →
   denied. Kill switch off → 404, and issuing still works.
4. The route writes nothing (row counts unchanged). The audit entry, if
   approved, contains codes and counts only (asserted: no draft text in
   `afterValue`).
5. PC-08 triggers for a queued run and for an unreviewed transcript, and clears
   after review.
6. Rules version `ai5-rules-v1` is returned and pinned in tests.

## 11. Delivery estimate

About 2 working days after approval: rules and tests (1 day), route, service
and audit (½ day), Review-step UI and DB integration suite in CI (½ day). No
migration.

## 12. Decisions (made 2026-09-27, following common clinical decision-support practice: few interruptive alerts, clinician override with an audit trail, no hard stops)

| # | Question | Decision |
|---|---|---|
| Q1 | Include FR-10.5's optional **AI candidate warnings** in v1? | **No.** Deterministic, inspectable rules only, like AI-4. Revisit once v1 is in use. |
| Q2 | Must the doctor acknowledge before issuing? | **Only for Review-required checks** (PC-07, PC-01, PC-02): one tick-box in the existing confirmation, enforced by the server. Consider-tier checks never interrupt, to limit alert fatigue. |
| Q3 | Record which checks were shown? | **Yes**, in the existing `PRESCRIPTION_ISSUED` audit entry: `preIssueChecks: { rulesVersion, counts, skipped, acknowledged }`. Codes and counts only, no names or text. No new table. |
| Q4 | Severity levels? | **Two non-blocking tiers** (Review required / Consider), no hard-stop level. A block would need a validated clinical ruleset. |
| Q5 | Who signs off the §5.2 form↔route table and the §5.3 quantity rule? | **Dr. Hatoda Tyagi**, the same reviewer as AI-4. `PRESCRIPTION_CHECKS_ENABLED` stays `false` until then. |
| Q6 | Which module gates it? | **`prescriptions`**, since no AI is involved, plus the `PRESCRIPTION_CHECKS_ENABLED` kill switch. PC-07 and PC-08 follow their own AI flags and permissions. |

## 13. Out of scope (need a drug master, patient data or a ruleset)

Dose-range, paediatric, renal, hepatic and pregnancy checks; interactions; drug
class and brand→generic mapping; allergy cross-reactivity; Schedule H/H1/X
labelling and record-keeping; prescription-format compliance (NMC/State
Council); controlled-substance limits; any hard block on issuing.
