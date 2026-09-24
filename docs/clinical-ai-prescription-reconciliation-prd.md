# Phase AI-4 — Prescription Reconciliation (PRD draft)

> **Status: DRAFT — awaiting approval of §12.** No code, tables or migrations
> exist for AI-4. Implements PRD FR-10.4: "Reconcile the prescription draft
> against accepted AI-3 facts; discrepancies only, no automatic prescription
> change."

## 1. Purpose

While a doctor edits a prescription draft, show where the draft **differs from
what the doctor accepted as said in the consultation** (AI-3 accepted facts).
Every item is a prompt to look again, with the evidence quote and an audio
seek. The doctor decides; MedCare changes nothing.

AI-4 must never:

- add, remove or edit a prescription item, consultation note or patient record;
- block, delay or gate issuing a prescription (pre-issue checks are AI-5);
- recommend a drug, dose or alternative, or claim a draft is "correct" or "safe";
- use facts that are not ACCEPTED on the transcript's **current** review;
- report "no allergies" or "no discrepancies" as a clinical finding: an empty
  result only means nothing comparable was found.

## 2. Baseline (verified in code, 2026-09-24)

| Existing capability | Where | Used by AI-4 for |
|---|---|---|
| Accepted, non-stale facts with evidence quotes and segment IDs | `getAcceptedTranscriptFacts()` (AI-3) | The only fact input |
| Fact attributes as verbatim substrings: medication `name/strength/dose/route/frequency/duration`, `FOLLOW_UP.interval` | `clinical_fact_candidates.attributes` | Values to normalize and compare |
| Draft items: `medicineGenericName`, `brandName`, `strength`, `dose`, `frequency`, `durationValue`, `durationUnit` (free text; no drug master) | `prescription_items` | The other side of the comparison |
| Consultation `followUpInstructions` (free text) | `clinical_consultations` / draft `clinicalJson` | Follow-up comparison |
| Linked assigned-Doctor authorization for drafts | `authorizeWriting()` pattern (AI-1) | Actor and scope |
| Several recordings per visit, each with its own transcript and review | `consultation_recordings`, `clinical_transcripts` | Facts are unioned across the visit's transcripts |

**Not available, and not built by AI-4:** a patient allergy record (no allergy
field or table exists), a drug master or brand→generic mapping, drug classes,
interactions or dose ranges.

## 3. Flow

```
Doctor edits prescription draft (consultation page)
  → "Check against consultation" panel sends the CURRENT editor state
    (unsaved items + follow-up text) to the server; nothing is persisted
  → Server loads accepted facts of every current transcript review of the visit
  → Deterministic normalization + comparison (§5, §6), rules version pinned
  → Results: Discrepancies (prominent), Matches (collapsed), Not comparable (count)
  → Each result shows the fact's evidence quote, "Listen at …", and the draft item
```

No AI provider call is made (see Q1). Results are recomputed on request and
never stored (see Q2), so they cannot go stale: a transcript correction removes
the facts (AI-3 staleness) and an edited draft is re-sent.

## 4. Inputs and eligibility

A fact is compared only when **all** hold:

- decision ACCEPTED, run COMPLETED and not stale (AI-3 §8);
- subject `PATIENT`;
- category and assertion are in the table below.

| Category | Assertions used | Compared with |
|---|---|---|
| `MEDICATION_MENTION` | `PRESENT` | draft items |
| `ALLERGY` | `PRESENT` | draft item names |
| `FOLLOW_UP` | `PRESENT` | draft follow-up instructions |

`NEGATED`, `UNCERTAIN`, `HISTORICAL` and `CONDITIONAL` facts are never
compared. Conflicting fact groups (AI-3 §7) are shown once as **Conflicting —
not compared** so a contradiction is never resolved silently.

## 5. Deterministic normalization (versioned `RECONCILE_RULES_VERSION`)

All rules are fixed lookup tables in code with unit tests; anything a rule does
not recognise is **Not comparable**, never a discrepancy and never a match.

| Value | Accepted forms (v1) | Canonical form |
|---|---|---|
| Drug name | lowercase; strip dosage-form words (tab, tablet, cap, capsule, syp, syrup, inj, injection, drops, cream, ointment) and any strength; collapse spaces | name token string |
| Strength | `<number><unit>` with or without a space; mg, mcg, g, ml, IU, % | number in mg / mcg / ml / IU / % (g → mg) |
| Frequency | OD, QD, once daily, once a day, 1-0-0 / 0-1-0 / 0-0-1, HS, at night; BD, BID, twice daily, 1-0-1; TDS, TID, thrice daily, 1-1-1; QID, 1-1-1-1; SOS, PRN, as needed; weekly, once a week; Hinglish `ek baar`, `do baar`, `teen baar`, `din mein do baar`, `raat ko` (Q5) | doses per day, or `PRN`, or per-week |
| Duration | `<n> day(s)/week(s)/month(s)`, `<n> din`, `hafta/hafte`, `mahina/mahine`; number words one–ten and `ek`–`das` (Q5) | days (week = 7, month = 30) |
| Follow-up interval | same as duration, plus "after", "baad" | days |

Devanagari drug names are Not comparable in v1. Since 2026-09-24, Sarvam's
codemix mode keeps English words, including most drug names, in Latin script.

## 6. Checks (v1)

| Code | Condition | Shown as |
|---|---|---|
| `MEDICATION_NOT_ON_DRAFT` | A medication fact's normalized name matches neither the generic nor the brand name of any draft item | "Discussed in consultation, not on this prescription" |
| `STRENGTH_DIFFERS` | Name matches an item; both strengths normalize; values differ | "Strength differs: said 650 mg, draft 500 mg" |
| `FREQUENCY_DIFFERS` | Name matches; both frequencies normalize; differ | "Frequency differs: said twice daily, draft once daily" |
| `DURATION_DIFFERS` | Name matches; both durations normalize; differ | "Duration differs: said 5 days, draft 7 days" |
| `ALLERGY_NAME_ON_DRAFT` | An allergy fact's substance name equals a draft item's generic or brand name after normalization | "Allergy mentioned for this name" + fixed notice: *Name match only. Drug-class allergies (e.g. penicillin → amoxicillin) are not checked.* |
| `FOLLOW_UP_DIFFERS` | Follow-up interval normalizes; no interval in the draft's follow-up text normalizes to the same number of days | "Follow-up said 7 days; draft does not state it" |

There's deliberately no "prescribed but not discussed" check: doctors often
prescribe without saying so aloud, so it would mostly be noise.

A name match requires the whole normalized name (no substring, no fuzzy or
edit-distance matching). Look-alike drug names are a known hazard, and AI-1
already refuses to respell them.

## 7. API

`POST /api/clinical-ai/registrations/:registrationId/reconciliation`

- Body: `{ items: [{ medicineGenericName, brandName, strength, frequency,
  durationValue, durationUnit }], followUpInstructions }`, validated by Zod with
  the same bounds as the draft save; at most 50 items. Not persisted.
- Response: `{ rulesVersion, results: [{ code, status: DISCREPANCY|MATCH|NOT_COMPARABLE|CONFLICTING, factId, itemIndex?, said, draft, evidence: [{ segmentId, quote, startMs }] }], notComparableCount }`
- `Cache-Control: private, no-store`. Metadata-only logging (counts, latency).
  No clinical text in logs, `ai_runs` or audit payloads.

## 8. Security, privacy and RBAC

| Control | Proposal |
|---|---|
| Runtime kill switch | `CLINICAL_RECONCILIATION_ENABLED` (plus `AI_ENABLED`, `CLINICAL_FACTS_ENABLED`) |
| Module | existing `clinical_ai` |
| Permission | reuse `clinical-ai:facts-review` + `prescription:draft` (Q4) |
| Actor | the visit's linked assigned Doctor, as in AI-1/AI-3 |
| Scope | tenant + clinic + registration from the session; foreign IDs → 404 |
| Provider | none (Q1) |

## 9. UI

A collapsible **Check against consultation** panel below the prescription
items. It is shown only when the visit has at least one accepted fact on a
current review. Discrepancies are listed first with evidence and audio seek.
Matches are collapsed. A footer counts the facts that couldn't be compared and
shows the fixed notice: *"This compares your draft with facts you accepted from
the transcript. It is not a safety or interaction check."* There is no Accept,
Apply or Fix button.

## 10. Acceptance criteria

- No draft, consultation or patient row changes when the panel is used (DB test).
- Stale, dismissed, unreviewed, negated, uncertain, historical, conditional and
  non-patient facts never appear (unit + DB tests).
- Every §5 table entry has a unit test; unrecognised inputs are Not comparable.
- A synthetic suite covers a name mismatch, each attribute mismatch, a Hinglish
  frequency, a Devanagari name (not comparable), a look-alike drug name (no
  match), an allergy name match and a conflicting pair, with exact expected output.
- Cross-tenant, cross-clinic and unassigned-doctor requests are denied.
- Issuing a prescription behaves identically with the feature on or off.
- Playwright E2E: accepted facts → draft edit → discrepancy shown → edit draft → it clears.

## 11. Delivery estimate

With no tables (Q2 as recommended), expect one PR: normalization module and
tests, API route, panel, and DB/E2E tests. It needs no migration and doesn't
touch the production database schema.

## 12. Open questions (decisions needed)

- **Q1. Deterministic only, with no AI call in v1?** Recommended: **yes**. Every
  result is reproducible and testable, it costs nothing and there's no
  hallucination surface. An AI pass could add fuzzy matching later, but only as
  suggestions that are themselves validated.
- **Q2. Store the doctor's acknowledgements of each discrepancy?** Recommended:
  **not in v1**. Results are computed and never stored, so there are **no new
  tables**. If acknowledgement records are needed, add one append-only
  table in AI-5, where pre-issue checks need a record of what the doctor saw.
- **Q3. v1 checks:** medications + allergy name + follow-up (recommended), or
  also investigations and diagnosis? Those compare free text with free text and
  would be noisy without a terminology service.
- **Q4. Permission:** reuse `clinical-ai:facts-review` (recommended: the same
  doctors who accept facts use them), or add `clinical-ai:reconcile`?
- **Q5. Hinglish lexicon sign-off.** The frequency, duration and number-word
  tables in §5 are clinical content. Who is the named clinician reviewer (for
  example Dr. Hatoda Tyagi, the pilot doctor)? Nothing ships until they approve
  the tables.
- **Q6. Allergies:** ship name-match only with the fixed disclaimer
  (recommended), or wait for a licensed drug-class database? A licensed
  database is a commercial decision, and so is a patient allergy record, which
  would add a table to PRD §7.

## 13. Out of scope

Drug–drug interactions, dose-range and renal/hepatic checks, drug-class allergy
cross-reactivity, a drug master or brand→generic mapping, a patient allergy
record, auto-filling or editing the prescription, blocking issue, and multi-visit
medication history. AI-5 (pre-issue checks) requires a jurisdiction-specific
legal and medical ruleset first.
