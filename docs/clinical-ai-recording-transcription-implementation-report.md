# AI-2A.3 implementation report and aggregate AI-2A status

Starting SHA: `ad2a5419eb24ae992b9f4707b106988cf2936d9a`, verified against the fetched remote branch. Baseline CI passed for that exact SHA (run 34888393739). Branch remains `codex/clinical-ai-recording-transcription`; existing [PR #6](https://github.com/pv-webservices/medcare-pro/pull/6) is the sole review destination. Final commit SHA and final CI state are recorded in the handoff and PR. User-owned `.codex/config.toml` MCP changes are excluded from this implementation commit.

## Aggregate implementation

The complete AI-2A layer contains explicit face-to-face recording consent, native browser capture/recovery, private multipart storage/playback, durable Sarvam Saaras v4 Batch transcription, immutable source/speaker/time evidence, clinician corrections and explicit review, tenant-approved Gemini fallback, separately stored Romanized source views, bounded raw-audio/provider-file cleanup, read-only production preflight, metadata health monitoring and a real-provider storage acceptance harness. Existing consultation Save and prescription issuance remain authoritative; no auto-write, medication extraction, reconciliation, telephony or AI-3 work is included.

Gemini uses the current `gemini-3.5-transcribe` Files/Interactions contract: streamed Files upload, `store:false`, verbatim mode, automatic language detection, speaker diarization and word offsets. Duration is capped at 30 minutes. Fallback requires a retained READY recording, valid consent, live assigned-Doctor/RBAC/tenant/clinic/entitlement checks, an eligible terminal technical Sarvam failure, no successful source transcript, valid server configuration and tenant-wide processor opt-in. The tenant default is false; clinic-scoped admins cannot grant tenant-wide approval. **Try Gemini** requires an explicit confirmation; retry remains Sarvam-only. Unique fallback/active keys preserve failed-primary provenance and prevent duplicate paid submissions. Ambiguous submission fails closed. Files are explicitly deleted in `finally`; durable metadata tracks pending deletion retries.

Configured Sarvam MCP and official endpoint documentation were consulted. The MCP language reference is broader than current transliteration endpoint coverage; the implementation uses the narrower documented languages. `POST /transliterate` targets `en-IN`, international numerals, `spoken_form:false`; no translation is used. Grapheme-safe, lossless splitting bounds each request to 1000 characters. Latin segments pass through exactly without provider calls; unsupported scripts (including the actual Urdu-script QA example) and failed segments preserve original text with a partial indicator. Derived views/segments live in dedicated tables, keyed by transcript/source hash/type and source segment. MariaDB source/identity triggers and four restrictive foreign keys protect bindings. A READ COMMITTED locked creation transaction reuses a single view across ten concurrent requests.

Retention is explicit from 1 to 3650 days for enabled production. READY completion freezes `audioDeleteAfter`; no historical backfill or implicit zero-day deletion is introduced. Cleanup uses skip-locked claims, 120-second fencing and metadata-only deletion/failure audits. Storage outage preserves the deletion state and schedules a 60-second retry; confirmed missing objects are idempotent. Active transcription is protected for at most 24 hours past the deadline, then fenced terminally with a full-lease delay before deletion. Source, corrections, review, speaker mappings and derived views survive deletion. Timestamp clicks show **Audio no longer retained** and both transcription providers reject deleted/expired audio. Terminal Gemini artifact cleanup is separately leased and retryable. Provider-side abandoned multipart lifecycle and each processor's own retention settings remain release prerequisites.

## Database and local validation

One additive migration: `20260915120000_clinical_ai2a3_hardening`. All 38 earlier migrations remain unchanged. Fresh disposable MariaDB 11.4.9 schemas replayed all 39 migrations successfully, including a separately named portal database required by its test guard. The audio verifier passes 46 checks covering checksums, existing evidence guards, new fallback/derived indexes, ownership triggers and restrictive foreign keys.

- Full unit suite: **167 files / 2,614 tests PASS**.
- Focused audio/provider suite: **eight files / 148 tests PASS**, including Gemini 36, Romanization 20, preflight 13 and retention nine tests.
- Recording DB integration: **40 checks PASS**; transcription/fallback/derived/retention DB integration: **74 checks PASS**.
- Audio browser: 15 enabled recording/original-transcript cases PASS; initial fallback case exceeded a 20-second status wait while its request remained in progress. Its corrected standalone rerun PASS verifies explicit opt-in/confirmation, PROCESSING to COMPLETED, provider display, 31-minute direct/UI rejection, partial Hindi/Latin/Urdu view and post-deletion behavior. Independent audio-off server: one case PASS. Aggregate: **16 enabled cases plus one independent audio-off case PASS**; one intentional off-only skip in the enabled suite.
- AI-1 DB: **32 checks PASS**. Prescription schema verifier **nine**, DB **58** PASS. Patient Portal verifier **16**, focused unit **61**, DB **88** PASS. RBAC **65**, Registrations **62** PASS.

Final production build PASS: all 39 migrations current, compiler and TypeScript PASS, 107 static pages generated. Browser regressions PASS: AI-1 eight, Electronic Prescription 26, and Patient Portal desktop/mobile two cases. Initial interrupted browser runs (including a local out-of-memory worker crash) and an incorrectly named portal test attempt are excluded from passing counts. Test guards were preserved. Full lint: zero errors/five pre-existing warnings. Staged real-secret/raw-audio exclusion and whitespace scans PASS; no provider credentials or raw audio enter source control.

## Live provider acceptance

Existing live Sarvam acceptance remains authoritative because its transport was preserved: [live QA](qa/2026-09-ai2a2-live-sarvam.md), two synthetic Hindi/Hinglish/English voices, `saaras:v4`, 23,390 ms WebM, zero clinically material and two minor transcription errors. No additional paid Sarvam STT job was run for this milestone.

**RUN — SYNTHETIC AUDIO ONLY** for Gemini. The first call failed normalization; one additional diagnostic attempt was separately authorized. Its successful HTTP response established absent IDs with `store:false` and `spk:0` speaker labels. Parser correction and offline capture normalization PASS (seven segments/two speakers); no third call was made. Uploaded Files were explicitly deleted after both calls. [Clinical-anchor matrix](clinical-audio-synthetic-gemini-qa.md) identifies ambiguous chest-pain negation despite retained dose/frequency/duration/laterality/numeric anchors. Live clinical-quality acceptance remains required; neither the imperfect synthetic voice fixture nor successful HTTP/normalization is production approval.

Sarvam transliteration transport **PASS — synthetic text only**: [QA](clinical-audio-synthetic-transliteration-qa.md). `Mane` differs from intended `Mujhe`; derived display never replaces original evidence.

**NOT RUN — real provider credentials not configured** for S3-compatible storage acceptance. The harness checks a private 18 MiB synthetic WAV, three signed parts, approved-origin CORS/ETag, HEAD bytes/MIME/SSE, signed-read integrity/expiry, browser playback, anonymous denial, bucket privacy APIs, deletion/absence and multipart abort, with finally cleanup. Unsupported privacy APIs or missing origin evidence make a real run conditional. No bucket/account or public audio object was created.

## Production preflight — current local configuration

Read-only command was run against disposable local MariaDB; current local development audio is already enabled. This is a local readiness report, not production verification. Actual environment values were not printed or changed.

| Check | Result |
| --- | --- |
| CLINICAL_AUDIO_ENABLED | PASS (ENABLED) |
| Private real storage provider | FAIL |
| Storage configuration completeness | FAIL |
| Storage TLS | FAIL |
| Explicit retention 1–3650 days | FAIL |
| Sarvam key present | PASS |
| Sarvam model/polling configuration | PASS |
| Sarvam webhook secret | PASS |
| Public callback HTTPS origin | PASS |
| Explicit Gemini fallback policy | FAIL |
| Gemini key present | PASS |
| Gemini fallback configuration | FAIL |
| Worker supervision declared | FAIL |
| Database migration status | PASS |

Metadata health command executes successfully and reports queue, lease/deadline, cleanup/retention and derived backlog counts without clinical text. The [production runbook](clinical-ai2a3-production-runbook.md) documents supervision alternatives without assuming Hostinger capabilities, private storage/CORS/encryption/lifecycle acceptance, processor governance, termination budgets, retention and rollout prerequisites. Enabled production fails closed on incomplete core configuration; missing Gemini disables fallback without breaking primary Sarvam, AI-1 or prescriptions. Recommended initial production flag remains `CLINICAL_AUDIO_ENABLED=false`.

## Privacy and production

No real patient data or audio used. No credentials, transcript or Romanized clinical text in application generic logs/AiRun/audits. Raw synthetic QA capture stays in dedicated local temporary artifacts; source/derived clinical text stays only in its dedicated clinical tables. No public audio objects, production environment/DB mutations, Hostinger configuration, deployment or feature enablement occurred. This is implementation review, not compliance approval.

**NOT DEPLOYED**

**CONDITIONAL PASS — AI-2A code is complete, but live Gemini and/or real object-storage acceptance remains required before production.**

## Historical AI-2A.2 implementation report

## Scope and Git

Branch: `codex/clinical-ai-recording-transcription`. Starting SHA: `fda6dd608277816c0d1711b42f3a9f65bc4f5049`. Implementation commit: `8ddb851c33df444d6fbe8ff850b2d0dd662a53df` (`feat(transcription): add Sarvam Batch worker and immutable clinician review`). Existing [PR #6](https://github.com/pv-webservices/medcare-pro/pull/6) remains the review destination. No merge, deployment or production configuration/migration is authorized. The final test/documentation commit SHA is recorded in the handoff and PR.

The existing recording/consent/storage/domain models were extended, not replaced. No new dependencies, transcription auto-enqueue, Gemini fallback, transliteration, retention cleanup, telephony changes or AI-3 features were introduced. The old mock/future-provider abstractions are not used by the live Batch worker; test injection is explicit and server/test-owned.

## Database

Two additive migrations: `20260914120000_sarvam_batch_transcription` and `20260914120100_transcription_evidence_guards`. Existing AI-2A.1 migration is unchanged. Changes affect TranscriptionRun (active key, fenced lease, submission/upload/poll checkpoints, callback hint), ClinicalTranscript (version), TranscriptSpeakerMapping (confirmation metadata) and TranscriptCorrection (unique supersession chain). No duplicate clinical models. Unique active recording/provider job keys, active-key CHECK/binding triggers and source/segment/correction/provider-speaker immutability guards are enforced by the database. All 30 existing restrictive foreign keys are preserved.

Fresh disposable MariaDB 11.4.9 database `medcare_ep_ai2a1_ai2a2_final` replayed all 38 migrations successfully. Verifier: 38 checks PASS, including migration SHA-256 matches, indexes, triggers, constraints and ownership. An earlier throwaway migration trial hit MariaDB's restriction on CHECK expressions referencing a foreign-key column; corrected to CHECK presence plus binding triggers and verified by fresh replay. No production DB was touched.

## Sarvam, worker and webhook

Direct fixed-origin REST Batch transport uses `saaras:v4`, verbatim mode, diarization, timestamps, requested two speakers and `language_code: unknown` autodetection. Server-owned keyterms: maximum 50 unique trimmed terms, 64 characters each. Only `SARVAM_API_SUBSCRIPTION_KEY` is accepted. HTTP timeout defaults 30 seconds (configurable 1–120 seconds), persisted polling defaults 30 seconds, job deadline 180 minutes. API JSON is bounded to 256 KiB, downloaded result JSON to 8 MiB before decoding/parsing; unsafe storage origins and redirects fail closed.

Private internal local/S3 streams upload to provider-issued HTTPS Azure Blob SAS destinations. No whole-recording buffer, public source URL or API key on storage requests. Output filename is taken from authoritative successful status, never guessed. Unsupported future storage backends require separate implementation.

Claims use row locks with SKIP LOCKED, 120-second token-fenced leases and renewal every 40 seconds. Provider ID is persisted before upload/start; recovery queries existing jobs and reuses checkpoints. Known transient errors receive persisted bounded backoff/jitter (three attempts). Definitively rejected create 429s may retry; ambiguous create/ID-write interruption fails closed because Sarvam does not document initiation idempotency. An informed manual retry can leave an orphan provider job and is not an exactly-once provider guarantee.

`POST /api/clinical-ai/transcription/webhooks/sarvam` validates the timing-safe callback header before reading a bounded body, returns 403 for invalid tokens, acknowledges unknown/duplicate/terminal jobs and only persists a polling hint for existing active Sarvam jobs. It never accepts transcript text, creates runs, finalizes results or makes provider calls.

## Transcript and clinician review

Atomic immutable source/ordered millisecond segments/provider speaker labels/UNKNOWN mappings and terminal run completion. Versioned canonical SHA-256 is an integrity checksum, not a signature. Strict finite nonnegative ordered timing validation allows overlapping speech and a two-second recording tolerance. At most 20,000 segments, 16 speakers, two million text characters and 16,000 characters per segment.

Live assigned-Doctor, tenant/clinic, RBAC, entitlement and kill-switch checks are server-owned. Clinician-confirmed roles cannot contain multiple Doctors. Explicit review requires one Doctor, a Patient and no UNKNOWN/unconfirmed speakers. Corrections append original evidence and supersession history; optimistic version checks reject stale edits. Mapping/correction changes invalidate previous review with metadata-only audits. Source/timestamps are never rewritten.

UI preserves the application's clinical styling, separates original evidence from corrections, paginates 50 segment controls, polls only application status, offers explicit Sarvam-only generation/retry, and reuses private player URLs for timestamp seek. Review is documentation attestation, not proof of medical accuracy.

## Added APIs

- POST `/api/clinical-ai/recordings/:recordingId/transcriptions`
- GET `/api/clinical-ai/recordings/:recordingId/transcriptions/latest`
- GET `/api/clinical-ai/transcripts/:transcriptId`
- POST `/api/clinical-ai/transcripts/:transcriptId/speakers/:speakerId/confirm`
- POST `/api/clinical-ai/transcript-segments/:segmentId/corrections`
- POST `/api/clinical-ai/transcripts/:transcriptId/review`
- POST `/api/clinical-ai/transcription/webhooks/sarvam`

Strict schemas reject browser provider/model/audio URL overrides; authenticated data is private/no-store. Legacy singular transcription endpoint stays disabled. Transcript-read does not grant mutation rights.

## Privacy

No audio in MySQL. No transcript text in generic logs. No raw Sarvam response stored in generic logs. No provider credentials in browser. No public audio URL. Sanitized provider failure categories only; signed bearer URL revocation limitations from AI-2A.1 remain. Tests use synthetic credentials, explicitly injected fake transports and disposable localhost databases, not real Sarvam traffic.

## Current verification

- Full Vitest: 163 files / 2,536 tests PASS.
- Focused audio/Sarvam/webhook: 70 tests PASS.
- Audio DB integration: 40 checks PASS; transcription DB integration: 48 checks PASS; schema verifier: 38 checks PASS.
- Recovery evidence reproduces expired persisted lease boundaries after claim, create before ID write, ID write, upload before/after checkpoint and start; no OS-level process-kill test is claimed. A real 41-second delayed submission verifies renewal and competing-claim rejection. Definite create 429, bounded retry, deadline, invalid diarization, stale fencing, duplicate callbacks, review invalidation and DB immutability are covered.
- Final production build PASS against disposable DB, no pending migrations, 106 static pages. Final typecheck PASS. Full lint: zero errors/five pre-existing warnings; subsequent test additions also pass focused lint.
- Audio browser: 15 enabled cases PASS / one audio-off case intentionally skipped; independent audio-off server: one case PASS. Standalone transcript rerun: one case PASS, preserving screenshots at `playwright-report/transcription-screenshots/transcript-{1366,768,390}.png` (not committed). Native fake mic, failure/Sarvam-only retry, source/mapping/review/correction/reload and exact 17-second seek/private URL reuse verified. No Next error dialog at completion; no horizontal overflow at tested widths.
- AI-1: 32 mock-backed DB checks / eight browser cases PASS.
- Electronic Prescription: nine verifier checks / 58 DB checks / 26 browser cases PASS.
- Patient Portal: 16 verifier checks / 61 focused unit tests / 88 DB checks / two desktop/mobile browser cases PASS on schema with all 38 migrations.
- Roles/RBAC: 65 checks PASS. Registrations: 62 checks PASS.
- There are 52 distinct passing browser cases across these final runs; the standalone transcript rerun is additional repeat evidence, not another distinct case.
- Secret scans and Git diff/staged whitespace checks PASS. Only placeholders/synthetic fixtures are committed; no real environment files, private audio, patient data or provider secrets.

Five existing lint warnings are unchanged (verify-stage11-audit, ClinicDetail, RegistrationsTable and two appointmentStatusVocabulary variables). Existing middleware deprecation, Tailwind module-type and color-option warnings remain. The full dependency audit remains six advisories (four high/two moderate); production-only audit has three high advisories through the existing Prisma/deepmerge-ts chain. No unrelated dependency changes were made.

The initial full development browser run emitted screenshot-caret hydration attribute warnings and a transient DashboardLayout mismatch. Its assertions still passed. The final standalone transcript rerun prewarms protected routes before native capture and preserves the screenshot caret; no hydration error appeared in that rerun. No production hydration fix is claimed. Screenshots were visually inspected at all three widths; sticky dashboard furniture is positioned at the scrolled viewport in full-page captures.

## AI-2A.2 milestone verdict

PASS — AI-2A.2 Sarvam transcription and clinician-review layer is ready for AI-2A.3.

## Live Sarvam QA

NOT RUN — credentials/webhook environment unavailable.

No real clinical audio or paid provider request was used. Synthetic mocked anchors include Metformin 500 mg / once daily / no chest pain / three days / left knee. This is transport/workflow evidence, not live language/model-quality acceptance.

## Production

NOT DEPLOYED

Worker process supervision, live synthetic-language QA, real private S3 acceptance and operational production sign-off remain deferred. Stop after the AI-2A.2 review-ready commit/push/PR update; AI-2A.3 and AI-3 are out of scope.

---

# Historical AI-2A.1 implementation report

## Git and scope

Branch: codex/clinical-ai-recording-transcription. Starting main SHA: e976dc6555e909772c8203877250f793b4b3948c. Database gate checkpoint: 842cab1 (feat(clinical-audio): add verified AI-2A recording foundation). Final browser/storage commit and PR are recorded in the handoff; no merge/deployment.

Initial inventory: consent/models/permissions/state APIs/provider mocks/lease primitive COMPLETE as foundation; DB proof MISSING; browser/IndexedDB/upload/playback MISSING; storage/provider interfaces PARTIAL; real transcription/worker/webhook PLACEHOLDER and intentionally deferred. Existing abstractions were reused.

## Database verification

Docker daemon unavailable; used portable MariaDB 11.4.9, isolated new temp data directory, loopback port33341, throwaway process-local credentials and medcare_ep_ai2a1_* schemas. No production access or .env changes.

All 36 migrations replayed from empty schema. 20260914010000_clinical_recording_transcription PASS. Fixed an overlong generated index name and removed an unintended nullable transcript Doctor FK; historical migrations unchanged. Added upload metadata and active-state CHECK to this never-deployed migration and replayed it fresh in medcare_ep_ai2a1_release. migrate status: up to date.

23 database verification checks PASS: consent/indexes, all 30 new FKs RESTRICT, one-active concurrency exactly one succeeds/one rejects, independent unique-index duplicate rejection, null-key active bypass rejected, transitions/duplicate stop, delete restrictions, Doctor identity/tenant/clinic isolation, withdrawal/audit/no jobs.

## Recording UI/browser

Additive Recording & Transcript panel in existing Consultation workspace; explicit unselected attestation and consent method/representative fields. Mic permission only on Check microphone; Web Audio RMS meter/input label transient. Server-gated Start/Pause/Resume, same recording/session. Stop waits final chunk and persistence before server stop; visible timer/status and cleanup.

MIME capability preference webm+opus, ogg+opus, mp4, webm. Native MediaRecorder timeslice10000ms; performance.now excludes pauses; configured maximum auto-stops. Track-ended safely stops; denied/unsupported errors are controlled. React review fixed consent-refresh click race and timer interval reset under frequent meter renders.

## IndexedDB

medcare-clinical-audio v1 sessions+compound-key chunks; atomic sequence validation/advancement, immediate persisted Blobs, no React audio array. Explicit reload recovery reauthorizes and never restarts mic. Confirmed discard aborts and clears. Interrupted upload retains local bytes. Withdrawal deletes chunks and persists non-uploadable tombstone on network failure; retry clears it. Confirmed READY deletes session/chunks. Exit/link warnings preserve confirmed navigation.

Hard crash may lose incomplete timeslice; quota/eviction/device loss remain local-resilience limitations.

## Storage/upload/playback

RecordingStorageProvider implemented with deterministic memory, private dev-only local HMAC adapter, official AWS SDK v3 configurable S3-compatible adapter. Production rejects local/memory/incomplete/non-TLS configuration. No public ACL; SSE AES256/aws:kms. Server-generated opaque ID keys, no patient personal identifiers.

Signed multipart init/part/complete/abort APIs validate live actor, assigned Doctor, tenant/clinic/Registration, entitlement/switch, editable state, consent, MIME/duration/expected size. 8 MiB parts, bounded contiguous ascending ETags; browser direct PUTs one part at a time with three attempts/fresh signatures. Upload ID persists; init and identical completion idempotent. Exact size/MIME HEAD verification precedes READY; HEAD recovers interrupted DB commit after successful storage completion.

Local SHA-256 computed incrementally during part assembly. S3 sha256 nullable; exact HEAD size/MIME checked without trusting browser digest or treating multipart ETag as SHA-256. Local playback streams range/full reads to avoid whole-file buffering.

Playback requires separate clinical-ai:transcript-read plus live assigned Doctor/entitlement/READY/retained source/unwithdrawn consent. Private no-store signing TTL ≤300 seconds, safe history and HTML audio player. Already-issued S3 bearer URLs live until expiry; operational revocation/bucket controls are prerequisites.

Withdrawal commits terminal consent before provider I/O; outage cannot roll back consent. Cleanup retry and S3 NoSuchUpload idempotent abort supported; other provider failures remain visible/sanitized.

## Verification evidence

- Prisma validation/generation and full build PASS; build targeted disposable medcare_ep_ai2a1_release, no pending migrations, 105 static pages generated.
- typecheck PASS; lint PASS, zero errors/five pre-existing warnings.
- Full unit suite: 161 files, 2,495 tests PASS.
- Focused audio: 29 unit tests in 2 files PASS; 40 DB integration checks PASS; 23 DB verification checks PASS.
- Audio browser final evidence: 14 enabled-flow E2E PASS (one audio-off test intentionally skipped in this run), including native fake-mic capture/pause/resume/stop/upload/private playback, reload recovery/discard, withdrawal/network interruption, retries, permissions, three viewports, microphone denial/unsupported/device loss and maximum-duration auto-stop.
- Audio disabled independent server: 1 E2E PASS.
- AI-1: 32 mock-backed DB checks and 8 E2E PASS.
- Electronic prescription: 9 verification checks, 58 DB checks, 26 E2E PASS.
- Patient Portal: 16 verification checks, 61 focused unit tests, 88 DB checks, 2 desktop/mobile E2E PASS.
- Additional applicable Roles/RBAC and Registrations verification scripts: all checks PASS.
- Secret scan/diff whitespace check performed before push; environment placeholders and synthetic test fixtures only.

Initial browser run exposed consent readiness race and an ambiguous Next route-announcer alert locator; corrected without lowering expectations. A subsequent disposable release-schema browser rerun returned pre-capture privacy-safe 404 and was stopped, not counted as passing. Final browser evidence uses the separately verified disposable audio schema with fresh server and explicit HTTP200 consultation assertion.

## Warnings and operational limits

Five pre-existing lint warnings: verify-stage11-audit betaRoles, ClinicDetail buttonClasses, RegistrationsTable VISIT_TYPE_LABELS, appointmentStatusVocabulary OCCUPYING_STATUSES/RELEASING_STATUSES. Existing middleware convention deprecation and tailwind module-type warnings remain. npm audit: six advisories (four high/two moderate) through Prisma/deepmerge-ts, js-yaml and Vitest/mocker; unrelated major upgrades/downgrades were not applied.

Live S3/R2/B2 acceptance not run. Private bucket/public-access block, least-privilege credentials, SSE compatibility, narrow origin CORS/ETag exposure, organizational consent/browser policy and orphan multipart lifecycle require sign-off. Retention timestamp metadata only; no cleanup worker. Source audio/transcription must not be enabled in production from local evidence alone.

## Live providers

NOT RUN — AI-2A.1 intentionally uses no live transcription provider.

## Production

NOT DEPLOYED

## Milestone verdict

PASS — AI-2A.1 recording and storage layer is ready for transcription integration.

Local implementation/verification complete; commit/push/PR are recorded in the handoff. AI-2A.2 transcription/worker/webhook/transcript UI and AI-3 are not implemented.
