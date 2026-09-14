-- Additive AI-2A.2 migration; original AI-2A.1 migration remains unchanged.
ALTER TABLE transcription_runs
  ADD COLUMN active_key VARCHAR(191) NULL,
  ADD COLUMN lease_token CHAR(36) NULL,
  ADD COLUMN submission_intent_at DATETIME(3) NULL,
  ADD COLUMN upload_completed_at DATETIME(3) NULL,
  ADD COLUMN last_poll_at DATETIME(3) NULL,
  ADD COLUMN callback_state VARCHAR(32) NULL;
CREATE UNIQUE INDEX transcription_runs_active_key_key ON transcription_runs(active_key);
CREATE UNIQUE INDEX transcription_runs_provider_provider_job_id_key ON transcription_runs(provider, provider_job_id);
ALTER TABLE clinical_transcripts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE transcript_speaker_mappings
  ADD COLUMN confirmed_at DATETIME(3) NULL,
  ADD COLUMN confirmed_by_user_id VARCHAR(191) NULL;
ALTER TABLE transcript_corrections ADD COLUMN supersedes_correction_id VARCHAR(191) NULL;
CREATE UNIQUE INDEX transcript_corrections_supersedes_correction_id_key ON transcript_corrections(supersedes_correction_id);
-- Existing queued rows must not silently evade the new active-run guard.
-- Fail closed rather than choosing a winner if historical duplicates exist.
UPDATE transcription_runs SET active_key = recording_id
WHERE status IN ('QUEUED', 'PREPARING', 'SUBMITTED', 'PROCESSING');
