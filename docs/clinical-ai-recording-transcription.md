# Clinical AI-2A: recording and transcription

AI-2A is limited to consented, face-to-face consultation audio captured from a single browser microphone. It does not record Plivo, WhatsApp, WebRTC, Zoom/Meet, or other remote calls, and it does not diagnose, recommend treatment, create prescriptions, extract facts, or populate consultation notes.

## Safety boundary

Recording requires an active tenant, the `clinical_ai` entitlement, `prescription:draft`, `clinical-ai:recording`, an assigned Doctor linked to the authenticated user, and an editable registration. Tenant Owner/Admin authority alone does not substitute for that Doctor identity. Transcript requests additionally require `clinical-ai:transcription`; reading requires `clinical-ai:transcript-read`.

The separate `CLINICAL_AUDIO_ENABLED` switch must be `true`. It is independent from AI-1's `AI_ENABLED` switch, so disabling audio does not disable writing assistance.

## Data flow

```text
Microphone -> browser temporary chunks -> private object storage
          -> server-created TranscriptionRun -> Sarvam Saaras v4 Batch
          -> normalized immutable ClinicalTranscript + segments
          -> clinician speaker mapping / append-only corrections
```

MySQL stores metadata, consent, state events, transcript text and normalized segments. It never stores audio bytes. Object keys are opaque IDs and must not contain patient identifiers. Production storage is fail-closed unless an S3-compatible provider is configured; local/memory providers are test/development only.

## State and privacy

Recording state is `CREATED -> RECORDING <-> PAUSED -> STOPPED -> UPLOADING -> READY`, with explicit `ABORTED` and `FAILED` paths. A unique `active_key` plus a registration row lock prevents two active sessions for one visit. Consent withdrawal aborts the recording and prevents transcription. Source transcript text is never overwritten; corrections are append-only.

Sarvam is configured for `saaras:v4`, `verbatim`, diarization, two expected speakers, and optional keyterms. Sarvam Batch is required for long audio and speaker diarization. Gemini is represented as a separate provider boundary for an approved future fallback; no live provider calls are made by tests or this local implementation.

## Required configuration

See `.env.example` for the server-only configuration. Before production, configure a private TLS S3-compatible bucket, server-side encryption, narrow CORS, short-lived multipart signing, lifecycle/retention policy, Sarvam credentials and webhook authentication, a reliable worker, and organizational consent/provider-retention policy.

## Current implementation boundary

The branch contains the additive Prisma domain, consent/recording authorization and state APIs, storage/provider interfaces, worker leasing primitive, configuration validation, and deterministic provider mocks. Browser IndexedDB chunk persistence, S3 multipart signing, Sarvam/Gemini transport, webhook verification, transcript review routes/UI, transliteration, retention worker, and Playwright coverage remain production prerequisites and are intentionally not implied by a green typecheck.
