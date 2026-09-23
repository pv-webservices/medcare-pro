# Clinical AI recording and transcription — AI-2A.3

AI-2A.3 adds explicit tenant-approved Gemini fallback, separately stored Romanized source views, raw-audio/provider-file cleanup, read-only production preflight, metadata health checks and a real-provider storage acceptance harness. See [production runbook](clinical-ai2a3-production-runbook.md), [Gemini synthetic QA](clinical-audio-synthetic-gemini-qa.md) and [Sarvam synthetic transliteration QA](clinical-audio-synthetic-transliteration-qa.md). The sections below preserve the foundation and primary Sarvam contracts. No production release or enablement is part of this milestone.

## AI-2A.1 foundation scope and data flow

Consented IN_PERSON browser microphone → MediaRecorder → IndexedDB → reconstructed Blob → signed multipart upload → private storage → HEAD verification → Recording READY → authorized playback.

The AI-2A.1 foundation did not capture Plivo/WhatsApp/remote calls, modify notes/prescriptions, generate transcripts or enqueue transcription. Its singular transcription endpoint remains disabled; AI-2A.2 uses the plural Batch integration documented below.

## Identity and consent

Live server-side authorization derives active user/tenant, clinic, Registration, patient and assigned linked Doctor. Owner/Admin wildcard rights never impersonate a Doctor. Recording writes require prescription:draft, clinical-ai:recording, clinical_ai/prescriptions entitlements, editable IN_PERSON consultation and valid consent. Read/cleanup paths use prescription:read and live visit ownership. Playback separately requires clinical-ai:transcript-read. Foreign resources return privacy-safe 404.

Doctor explicitly attests verbal/written/digital consent from patient/guardian/authorized representative. Neither consent nor microphone permission is automatic. AI_ENABLED and the independent CLINICAL_AUDIO_ENABLED gate audio; audio off preserves AI-1. Customized historical roles are not migrated by name.

## Browser and IndexedDB

The additive Recording & Transcript panel preserves consultation notes and prescriptions. Check microphone explicitly calls getUserMedia with optional echoCancellation/noiseSuppression/autoGainControl and shows selected input label and transient Web Audio RMS meter. No device identifiers or meter telemetry are stored.

MIME preference: audio/webm;codecs=opus, audio/ogg;codecs=opus, audio/mp4, audio/webm, selected by isTypeSupported. Controlled error messages cover unsupported/denied/missing/busy microphone. Server start/pause/resume succeeds before MediaRecorder transitions. Timeslice is 10000ms, not a duration estimate. performance.now excludes paused periods; configured maximum auto-stops. Device ended stops safely; mute shows feedback.

Each dataavailable Blob is queued immediately into IndexedDB rather than an accumulating React array. Stop waits for final dataavailable and all writes, validates contiguous chunks, reconstructs nonempty Blob, then stops server state.

medcare-clinical-audio v1 has sessions keyed by recordingId and chunks keyed by [recordingId,sequence], indexed by recordingId. Session fields: registrationId, MIME, timestamps, state, nextSequence, elapsedMs. Chunk fields: Blob, size, createdAt. Chunk insertion and sequence advancement are atomic.

Reload presents this Registration's unfinished sessions without automatic upload/microphone restart. Recover reauthorizes and uploads existing captured audio. Confirmed Discard aborts server state/multipart and removes local data. Upload interruption retains chunks for explicit retry. Withdrawal stops capture and deletes chunks immediately; failed server withdrawal retains a withdrawn metadata tombstone, which cannot be recovered for upload and permits cleanup retry. Successful READY confirmation deletes session and chunks. beforeunload and link warnings permit confirmed exit.

IndexedDB is temporary device-local resilience, not permanent storage. Hard crash can lose an incomplete timeslice; eviction, device loss and quota failure cannot be recovered server-side. Organizational browser/device acceptance remains necessary.

## Database and upload

CREATED → RECORDING ↔ PAUSED → STOPPED → UPLOADING → READY; ABORTED/FAILED are terminal. Registration/recording locks plus unique active_key prevent concurrent unfinished sessions. CHECK prohibits null active_key in unfinished states. The key remains occupied through upload and clears terminally. All 30 new clinical FKs use RESTRICT; historical migrations are unchanged.

RecordingStorageProvider supports multipart create/sign/complete/abort, HEAD, signed read and delete. Server alone generates clinical-recordings/{opaqueTenantId}/{opaqueRecordingId}/source.{webm|ogg|mp4}; no names, phone/email, diagnosis or browser-selected key.

POST /api/clinical-ai/recordings/:id/upload/init validates identity/state/consent/MIME/exact duration/expected bytes and persists/reuses upload metadata. /upload/part signs bounded expected part numbers/sizes. Browser PUTs directly to S3, one 8 MiB part at a time (nonfinal ≥5 MiB), retaining ETags and retrying up to three times with fresh instructions. /upload/complete validates contiguous unique ascending parts/ETags, locks and reauthorizes, completes multipart, verifies exact nonzero HEAD length/MIME/limit, then sets READY. Identical completion is idempotent; conflicts are rejected. HEAD permits recovery if storage completed before a database interruption. /upload/abort discards; withdrawal prevents completion and aborts/deletes pending storage.

## Private storage and playback

Official AWS SDK v3 S3 adapter uses configurable TLS endpoint/region/path style, AES256 or aws:kms SSE, no public ACL and bounded signing. InMemoryRecordingStorage is deterministic test-only. LocalRecordingStorageProvider is development-only, outside public, with expiring HMAC-bound instructions, traversal-safe keys, ETag validation and streamed private range playback.

Local completion incrementally hashes parts into full-object SHA-256. S3 verifies size/MIME via HEAD and leaves sha256 nullable: multipart ETag is not SHA-256 and a browser hash is not trusted. Unsafe whole-recording browser digest duplication is avoided; provider checksums or a streaming digest can extend integrity metadata later.

GET /api/clinical-ai/recordings/:id/audio-url requires assigned live Doctor, transcript-read permission, switches/entitlement, READY, retained source and unwithdrawn consent. TTL ≤300 seconds, private no-store responses, safe history metadata and HTML audio player. Local byte requests reauthorize. S3 URLs are bearer capabilities until expiry; do not share/log them. Immediate revocation of already-issued URLs requires object deletion/provider controls.

MySQL contains metadata only, never audio. No public objects, browser provider credentials, patient personal identifiers in keys, binary/generic audit logs or patient-portal audio routes.

## Configuration and boundaries

.env.example has placeholders only. Production rejects local/memory, incomplete S3 or non-TLS endpoints. Require a PRIVATE bucket with public access blocked, least-privilege credentials, supported SSE and narrow CORS for approved origins, PUT/GET/HEAD, ETag exposure. S3-compatible code is not live R2/B2/vendor certification.

Defaults: 120 minutes, 512 MiB and 300-second URLs. Optional retention sets metadata only; no cleanup worker is implemented. Orphan multipart lifecycle, consent/provider policy, live bucket acceptance and supported browser acceptance require separate operational sign-off.

No live S3 or transcription calls, webhook, production worker, deployment or AI-3. AI-2A.2 owns live Sarvam/worker/webhook/immutable transcript integration and subsequent approved review/retention operations.

## Verification

Scripts enforce disposable localhost test schemas. Override DATABASE_URL per process; never change production/.env. npm run build invokes migrations and therefore must target disposable DB. verify:clinical-audio checks migration/index/FKs/concurrency/state/consent/isolation. test:clinical-audio runs unit and mock-backed DB integration. test:e2e:clinical-audio uses fake Chromium microphone/local private storage; CLINICAL_AUDIO_E2E_DISABLED=true starts a separate kill-switch run. Exact evidence is in the implementation report.
# Phase AI-2A.2 — Sarvam Batch integration

This phase adds a server-side Sarvam Saaras v4 Batch transport, durable run worker, authenticated status hints, bounded result normalization and clinician transcript review. No transliteration, Gemini fallback, retention worker, production hardening rollout or AI-3 generation is included.

## Server configuration

Set `TRANSCRIPTION_PRIMARY_PROVIDER=sarvam`, `SARVAM_TRANSCRIPTION_MODEL=saaras:v4`, `TRANSCRIPTION_AUTO_FALLBACK=false` and server-only `SARVAM_API_SUBSCRIPTION_KEY`. `SARVAM_TIMEOUT_MS` defaults to 30000 (validated 1000–120000). `SARVAM_TRANSCRIPTION_KEYTERMS_JSON` is a unique JSON array of at most 50 trimmed, nonempty terms of at most 64 characters. No browser provider/model/keyterms/audio URL overrides are accepted.

Polling works without callbacks. Optional callbacks require both an HTTPS origin in `CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL` and a 32–512 character `SARVAM_WEBHOOK_SECRET`. The server constructs `/api/clinical-ai/transcription/webhooks/sarvam` and passes the secret as callback `auth_token`. The route validates `X-SARVAM-JOB-CALLBACK-TOKEN` before reading the request body; invalid authentication returns 403. Notifications only make an existing nonterminal job eligible for polling; they never create runs or finalize transcripts. Unknown/duplicate/terminal hints acknowledge safely.

Polling settings: `SARVAM_POLL_AFTER_SECONDS` (default 30), `SARVAM_POLL_INTERVAL_SECONDS` (default 30), `SARVAM_JOB_TIMEOUT_MINUTES` (default 180). Polling schedule and checkpoints persist in MySQL. Run `npm run clinical-audio:worker` for the loop or `npm run clinical-audio:worker:once` for a bounded single pass. SIGINT/SIGTERM stops new claims after the current job checkpoint returns. A worker runtime and scheduler are deployment prerequisites; this phase does not deploy them.

### Hostinger-compatible HTTP cron trigger

When the application is deployed on a platform that does not preserve arbitrary build files, set `CLINICAL_AUDIO_WORKER_MODE=external` and use the deployed Node.js route handlers instead of invoking a file beneath `.next`:

- `POST /api/internal/clinical-audio/worker` claims at most one transcription run, then performs at most one Romanization pass.
- `POST /api/internal/clinical-audio/cleanup` performs at most one recording-retention pass and one provider-artifact pass.
- `GET /api/internal/clinical-audio/health` returns queue/lease/retention counters only.

All three routes require `Authorization: Bearer <CLINICAL_AUDIO_CRON_SECRET>`. The dedicated server-only secret must be 32–512 characters. It is never accepted in a URL, path or request body and must not be logged. Missing configuration, invalid authentication, or disabled clinical audio fails closed. Responses are private/no-store and contain only bounded operational counts—never transcript text, patient identifiers, object keys, signed URLs, provider payloads or credentials.

The CLI scripts remain local/VPS operational entry points. Production cron commands must call the HTTPS routes; they must not depend on custom files within `.next/server`. Hostinger's managed Node.js deployment copies only its own build output into `hbuilds/versions/<build>`, so any file a build step writes under `.next/server` is absent at runtime (observed as `MODULE_NOT_FOUND` for `worker.mjs`).

Cron job listings are visible in hPanel and the hosting API, so the secret must not appear in the command. Store the header in a private file outside the site root, then reference it with `curl -H @file`:

```bash
printf 'Authorization: Bearer %s\n' '<CLINICAL_AUDIO_CRON_SECRET>' > ~/.clinical-audio-cron-header
chmod 600 ~/.clinical-audio-cron-header
```

```text
*/2 * * * *  curl -fsS --max-time 900 -X POST -H @$HOME/.clinical-audio-cron-header https://<domain>/api/internal/clinical-audio/worker
15 2 * * *   curl -fsS --max-time 300 -X POST -H @$HOME/.clinical-audio-cron-header https://<domain>/api/internal/clinical-audio/cleanup
```

Each worker call processes at most one transcription run. A run that is still at the provider returns after one status poll; only the first pass of a run uploads audio. The audio upload has a size-scaled deadline (at least 256 KiB/s, capped at 60 minutes) while the 120-second lease heartbeat keeps the claim alive, so an upload may outlast `--max-time`: a client disconnect does not stop the server-side pass, and overlapping triggers claim different runs. Failed passes log only `{ route, failure }` with a bounded category code; use `GET /api/internal/clinical-audio/health` with the same header for backlog counters.

## Durability and private transport

Two additive migrations introduce per-recording active keys, unique `(provider, providerJobId)`, fencing tokens, submission intent, upload checkpoints and last poll time. A CHECK prevents active rows with null keys; triggers enforce recording-key binding, COMPLETED terminal status and immutable source/segments/provider speaker identity/append-only correction history. Claims use row locks, skip-locked selection, expiration reclaim and 120-second leases with periodic renewal. Every worker write is fenced against a stale token/expired lease. A provider job ID is persisted before upload/start. Recovery queries the existing job before resuming. The worker requires a database version supporting `FOR UPDATE SKIP LOCKED` (locally verified with MariaDB 11.4.9).

Sarvam does not document an initiation idempotency key. A lost/ambiguous job-create response or interrupted job-ID persistence fails closed; it is not silently auto-created again. Explicit retry may leave an orphan provider job and should be an informed operational action. Known-job transient errors receive bounded persisted exponential backoff/jitter, maximum three attempts. Completed source/segments/UNKNOWN speakers and terminal run status commit together.

Audio stays in private recording storage. Internal `getObjectStream` implementations stream local/S3/memory objects to provider-issued HTTPS Azure Blob destinations; no public audio URL or whole-recording array buffer is used. Filenames contain only opaque recording IDs. Signed destination redirects and non-Azure/unsafe hosts are rejected. Provider credentials are sent only to the fixed Sarvam API origin, never signed blob URLs. Unsupported future Sarvam storage backends fail closed until separately implemented.

## Evidence and clinician review

Results use the single successful output filename from fresh authoritative job status, not a guessed `0.json`. Downloads are bounded to 8 MiB before UTF-8 decoding/JSON parsing. Validation requires diarized entries with nonempty text/IDs, finite ordered nonnegative times within recording duration plus 2 seconds, at most 20,000 entries and 16 provider speakers. Overlapping speech is supported. Milliseconds are rounded to the nearest integer. Source text, ordered provider segments, provider speaker identities and timestamps are never rewritten by review/correction services. SHA-256 covers a versioned canonical representation; it is an integrity checksum, not a digital signature.

Speakers start UNKNOWN. Clinicians listen and confirm Doctor/Patient/Caregiver/Other mappings. Multiple Doctor mappings are rejected; review requires one Doctor, at least one Patient and no unconfirmed/UNKNOWN speakers. Segment corrections append with a supersession chain while retaining original evidence. Version checks serialize concurrent edits. Corrections and mapping edits clear prior review and emit metadata-only audit events. Review is an explicit clinical-documentation attestation, not a guarantee of transcription accuracy.

Authenticated private/no-store endpoints:

- `POST /api/clinical-ai/recordings/:id/transcriptions` — strict empty object, explicit generation; duplicate active requests return the existing run.
- `GET /api/clinical-ai/recordings/:id/transcriptions/latest`
- `GET /api/clinical-ai/transcripts/:id`
- `POST /api/clinical-ai/transcripts/:id/speakers/:speakerId/confirm` — `speakerType`, `expectedVersion`.
- `POST /api/clinical-ai/transcript-segments/:id/corrections` — `correctedText`, `expectedVersion`.
- `POST /api/clinical-ai/transcripts/:id/review` — `attested: true`, `expectedVersion`.

Tenant, clinic, assigned linked Doctor, entitlements, active actor and feature switches remain server-authoritative. Read permission does not authorize mutations. New transcription also requires READY, retained private audio and unwithdrawn consent. The legacy singular `/transcription` endpoint remains disabled; new clients use the plural endpoint.

The recording panel polls the application's status API every 7.5 seconds while a run is active, never Sarvam directly. It displays immutable evidence separately from effective corrections and paginates segment controls in groups of 50. Timestamp buttons seek the existing authorized audio player and reuse unexpired signed access rather than requesting a URL on every click.

## Official references

- [Sarvam Batch initiation and job parameters](https://docs.sarvam.ai/api-reference/speech-to-text/stt/job/initiate)
- [Sarvam Batch status](https://docs.sarvam.ai/api-reference/speech-to-text/stt/job/status)
- [Sarvam result download contract](https://docs.sarvam.ai/api-reference/speech-to-text/stt/job/download)
- [Sarvam Batch callbacks and output format](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/batch-api)
- [Azure Blob PUT streaming headers](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)
