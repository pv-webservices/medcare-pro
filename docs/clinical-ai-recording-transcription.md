# Clinical AI recording — AI-2A.1

## Scope and data flow

Consented IN_PERSON browser microphone → MediaRecorder → IndexedDB → reconstructed Blob → signed multipart upload → private storage → HEAD verification → Recording READY → authorized playback.

This milestone does not capture Plivo/WhatsApp/remote calls, modify notes/prescriptions, generate transcripts or enqueue transcription. Provider mocks/interfaces and leasing primitives remain foundation only. The transcription endpoint is explicitly disabled.

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
