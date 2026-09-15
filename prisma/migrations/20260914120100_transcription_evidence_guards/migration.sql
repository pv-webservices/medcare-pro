-- Database backstops for active-run uniqueness and append-only source evidence.
ALTER TABLE transcription_runs ADD CONSTRAINT transcription_runs_active_key_check CHECK (
  (status IN ('QUEUED','PREPARING','SUBMITTED','PROCESSING') AND active_key IS NOT NULL)
  OR (status NOT IN ('QUEUED','PREPARING','SUBMITTED','PROCESSING') AND active_key IS NULL)
);

-- MariaDB forbids a CHECK expression referencing FK columns with update actions.
-- Enforce the exact recording-key binding with triggers instead.
CREATE TRIGGER transcription_active_key_insert BEFORE INSERT ON transcription_runs
FOR EACH ROW
BEGIN
  IF NEW.active_key IS NOT NULL AND NOT (BINARY NEW.active_key <=> BINARY NEW.recording_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid transcription active key';
  END IF;
END;
CREATE TRIGGER transcription_active_key_update BEFORE UPDATE ON transcription_runs
FOR EACH ROW
BEGIN
  IF NEW.active_key IS NOT NULL AND NOT (BINARY NEW.active_key <=> BINARY NEW.recording_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid transcription active key';
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status <> 'COMPLETED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed transcription is terminal';
  END IF;
END;

CREATE TRIGGER clinical_transcript_source_immutable BEFORE UPDATE ON clinical_transcripts
FOR EACH ROW
BEGIN
  IF NOT (BINARY NEW.source_text <=> BINARY OLD.source_text)
     OR NOT (BINARY NEW.source_hash <=> BINARY OLD.source_hash)
     OR NEW.transcription_run_id <> OLD.transcription_run_id
     OR NEW.recording_id <> OLD.recording_id
     OR NEW.registration_id <> OLD.registration_id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.clinic_id <> OLD.clinic_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable transcript source';
  END IF;
END;

CREATE TRIGGER clinical_transcript_segment_immutable BEFORE UPDATE ON clinical_transcript_segments
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable transcript segment';
CREATE TRIGGER clinical_transcript_segment_no_delete BEFORE DELETE ON clinical_transcript_segments
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable transcript segment';
CREATE TRIGGER transcript_correction_append_only BEFORE UPDATE ON transcript_corrections
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only transcript correction';
CREATE TRIGGER transcript_correction_no_delete BEFORE DELETE ON transcript_corrections
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only transcript correction';

CREATE TRIGGER transcript_speaker_identity_immutable BEFORE UPDATE ON transcript_speaker_mappings
FOR EACH ROW
BEGIN
  IF NEW.transcript_id <> OLD.transcript_id OR NOT (BINARY NEW.speaker_label <=> BINARY OLD.speaker_label) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable provider speaker identity';
  END IF;
END;
