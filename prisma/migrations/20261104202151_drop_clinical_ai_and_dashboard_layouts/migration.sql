-- RM-3: drop the retired Clinical AI (RM-1) and dashboard-layout (RM-2) tables.
--
-- Run only after the owner's verified production backup, scripts/purge-clinical-audio.mts
-- and scripts/clean-retired-catalogue.mts (see the PR rollout order).
--
-- Hand-reviewed version of `prisma migrate dev --create-only` output:
--   * No kept table has a foreign key into this set (checked against
--     information_schema), so only these 17 tables and one tenants column change.
--   * Foreign keys are not dropped by name. Every one of them lives on a table
--     dropped here, and tables are dropped children-before-parents, so each
--     constraint goes with its own table. This does not depend on production
--     constraint names matching the migration files.
--   * The 27 guard triggers created by the AI-2/AI-3 migrations are dropped
--     explicitly first (DROP TABLE would drop them too). No stored procedure,
--     function, event or view was ever created.
--   * IF EXISTS keeps a partially applied run safe to re-apply. The column drop
--     comes last.

-- Triggers on dropped tables
DROP TRIGGER IF EXISTS `fact_candidate_binding`;
DROP TRIGGER IF EXISTS `fact_candidate_immutable`;
DROP TRIGGER IF EXISTS `fact_candidate_no_delete`;
DROP TRIGGER IF EXISTS `fact_evidence_binding`;
DROP TRIGGER IF EXISTS `fact_evidence_immutable`;
DROP TRIGGER IF EXISTS `fact_evidence_no_delete`;
DROP TRIGGER IF EXISTS `fact_run_binding`;
DROP TRIGGER IF EXISTS `fact_run_identity_immutable`;
DROP TRIGGER IF EXISTS `fact_run_no_delete`;
DROP TRIGGER IF EXISTS `fact_review_append_only`;
DROP TRIGGER IF EXISTS `fact_review_binding`;
DROP TRIGGER IF EXISTS `fact_review_no_delete`;
DROP TRIGGER IF EXISTS `clinical_transcript_segment_immutable`;
DROP TRIGGER IF EXISTS `clinical_transcript_segment_no_delete`;
DROP TRIGGER IF EXISTS `clinical_transcript_source_immutable`;
DROP TRIGGER IF EXISTS `transcript_correction_append_only`;
DROP TRIGGER IF EXISTS `transcript_correction_no_delete`;
DROP TRIGGER IF EXISTS `derived_segment_identity_guard`;
DROP TRIGGER IF EXISTS `derived_segment_owner_guard`;
DROP TRIGGER IF EXISTS `derived_view_identity_guard`;
DROP TRIGGER IF EXISTS `derived_view_source_guard`;
DROP TRIGGER IF EXISTS `transcript_review_append_only`;
DROP TRIGGER IF EXISTS `transcript_review_binding`;
DROP TRIGGER IF EXISTS `transcript_review_no_delete`;
DROP TRIGGER IF EXISTS `transcript_speaker_identity_immutable`;
DROP TRIGGER IF EXISTS `transcription_active_key_insert`;
DROP TRIGGER IF EXISTS `transcription_active_key_update`;

-- Tables, children before parents
DROP TABLE IF EXISTS `ai_runs`;
DROP TABLE IF EXISTS `clinical_fact_evidence`;
DROP TABLE IF EXISTS `clinical_fact_reviews`;
DROP TABLE IF EXISTS `consultation_recording_events`;
DROP TABLE IF EXISTS `dashboard_layouts`;
DROP TABLE IF EXISTS `transcript_derived_segments`;
DROP TABLE IF EXISTS `transcript_speaker_mappings`;
DROP TABLE IF EXISTS `clinical_fact_candidates`;
DROP TABLE IF EXISTS `clinical_transcript_segments`;
DROP TABLE IF EXISTS `transcript_corrections`;
DROP TABLE IF EXISTS `transcript_derived_views`;
DROP TABLE IF EXISTS `clinical_fact_extraction_runs`;
DROP TABLE IF EXISTS `transcript_reviews`;
DROP TABLE IF EXISTS `clinical_transcripts`;
DROP TABLE IF EXISTS `transcription_runs`;
DROP TABLE IF EXISTS `consultation_recordings`;
DROP TABLE IF EXISTS `consultation_recording_consents`;

-- Tenant column used only by the removed Gemini transcription fallback
ALTER TABLE `tenants` DROP COLUMN `allow_gemini_transcription_fallback`;
