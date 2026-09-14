-- CreateTable
CREATE TABLE `consultation_recording_consents` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `captured_by_user_id` VARCHAR(191) NOT NULL,
    `method` ENUM('VERBAL', 'WRITTEN', 'DIGITAL') NOT NULL,
    `consenter_type` ENUM('PATIENT', 'GUARDIAN', 'AUTHORIZED_REPRESENTATIVE') NOT NULL,
    `consented_at` DATETIME(3) NOT NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `withdrawn_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recording_consent_tenant_clinic_created_idx`(`tenant_id`, `clinic_id`, `created_at`),
    INDEX `consultation_recording_consents_registration_id_created_at_idx`(`registration_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consultation_recordings` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `created_by_user_id` VARCHAR(191) NOT NULL,
    `consent_id` VARCHAR(191) NOT NULL,
    `status` ENUM('CREATED', 'RECORDING', 'PAUSED', 'STOPPED', 'UPLOADING', 'READY', 'ABORTED', 'FAILED') NOT NULL DEFAULT 'CREATED',
    `active_key` VARCHAR(191) NULL,
    `upload_id` VARCHAR(255) NULL,
    `upload_part_size` INTEGER NULL,
    `upload_part_count` INTEGER NULL,
    `upload_expected_bytes` BIGINT NULL,
    `upload_completed_parts_hash` CHAR(64) NULL,
    `mime_type` VARCHAR(128) NULL,
    `duration_ms` INTEGER NULL,
    `byte_size` BIGINT NULL,
    `storage_provider` VARCHAR(32) NULL,
    `storage_key` VARCHAR(512) NULL,
    `sha256` CHAR(64) NULL,
    `started_at` DATETIME(3) NULL,
    `stopped_at` DATETIME(3) NULL,
    `uploaded_at` DATETIME(3) NULL,
    `audio_delete_after` DATETIME(3) NULL,
    `audio_deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `consultation_recordings_consent_id_key`(`consent_id`),
    UNIQUE INDEX `consultation_recordings_active_key_key`(`active_key`),
    INDEX `consultation_recordings_tenant_id_clinic_id_created_at_idx`(`tenant_id`, `clinic_id`, `created_at`),
    INDEX `consultation_recordings_registration_id_created_at_idx`(`registration_id`, `created_at`),
    INDEX `consultation_recordings_status_idx`(`status`),
    INDEX `consultation_recordings_audio_delete_after_idx`(`audio_delete_after`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consultation_recording_events` (
    `id` VARCHAR(191) NOT NULL,
    `recording_id` VARCHAR(191) NOT NULL,
    `type` ENUM('START', 'PAUSE', 'RESUME', 'STOP', 'CONSENT_WITHDRAWN') NOT NULL,
    `client_elapsed_ms` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consultation_recording_events_recording_id_created_at_idx`(`recording_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcription_runs` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `recording_id` VARCHAR(191) NOT NULL,
    `requested_by_user_id` VARCHAR(191) NOT NULL,
    `provider` ENUM('SARVAM', 'GEMINI') NOT NULL,
    `model` VARCHAR(101) NOT NULL,
    `status` ENUM('QUEUED', 'PREPARING', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `mode` ENUM('VERBATIM') NOT NULL DEFAULT 'VERBATIM',
    `provider_job_id` VARCHAR(255) NULL,
    `provider_request_id` VARCHAR(255) NULL,
    `language_code` VARCHAR(32) NULL,
    `requested_speaker_count` INTEGER NULL,
    `attempt_number` INTEGER NOT NULL DEFAULT 1,
    `failure_code` VARCHAR(64) NULL,
    `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `next_attempt_at` DATETIME(3) NULL,
    `locked_at` DATETIME(3) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `locked_by` VARCHAR(128) NULL,
    `audio_duration_ms` INTEGER NULL,
    `audio_bytes` BIGINT NULL,
    `latency_ms` INTEGER NULL,
    `fallback_from_run_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transcription_runs_provider_status_next_attempt_at_idx`(`provider`, `status`, `next_attempt_at`),
    INDEX `transcription_runs_lease_expires_at_idx`(`lease_expires_at`),
    INDEX `transcription_runs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinical_transcripts` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `recording_id` VARCHAR(191) NOT NULL,
    `transcription_run_id` VARCHAR(191) NOT NULL,
    `source_text` LONGTEXT NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reviewed_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinical_transcripts_transcription_run_id_key`(`transcription_run_id`),
    INDEX `clinical_transcripts_tenant_id_clinic_id_created_at_idx`(`tenant_id`, `clinic_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinical_transcript_segments` (
    `id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `speaker_label` VARCHAR(64) NOT NULL,
    `start_ms` INTEGER NOT NULL,
    `end_ms` INTEGER NOT NULL,
    `text` TEXT NOT NULL,

    INDEX `clinical_transcript_segments_transcript_id_ordinal_idx`(`transcript_id`, `ordinal`),
    UNIQUE INDEX `clinical_transcript_segments_transcript_id_ordinal_key`(`transcript_id`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcript_speaker_mappings` (
    `id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `speaker_label` VARCHAR(64) NOT NULL,
    `speaker_type` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transcript_speaker_mappings_transcript_id_speaker_label_key`(`transcript_id`, `speaker_label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcript_corrections` (
    `id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `segment_id` VARCHAR(191) NULL,
    `original_text` TEXT NOT NULL,
    `corrected_text` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transcript_corrections_transcript_id_created_at_idx`(`transcript_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_captured_by_user_id_fkey` FOREIGN KEY (`captured_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_consents` ADD CONSTRAINT `consultation_recording_consents_withdrawn_by_user_id_fkey` FOREIGN KEY (`withdrawn_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `consultation_recordings_consent_id_fkey` FOREIGN KEY (`consent_id`) REFERENCES `consultation_recording_consents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consultation_recording_events` ADD CONSTRAINT `consultation_recording_events_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `consultation_recordings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `consultation_recordings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcription_runs` ADD CONSTRAINT `transcription_runs_fallback_from_run_id_fkey` FOREIGN KEY (`fallback_from_run_id`) REFERENCES `transcription_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcripts` ADD CONSTRAINT `clinical_transcripts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcripts` ADD CONSTRAINT `clinical_transcripts_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcripts` ADD CONSTRAINT `clinical_transcripts_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcripts` ADD CONSTRAINT `clinical_transcripts_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `consultation_recordings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcripts` ADD CONSTRAINT `clinical_transcripts_transcription_run_id_fkey` FOREIGN KEY (`transcription_run_id`) REFERENCES `transcription_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_transcript_segments` ADD CONSTRAINT `clinical_transcript_segments_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_speaker_mappings` ADD CONSTRAINT `transcript_speaker_mappings_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_corrections` ADD CONSTRAINT `transcript_corrections_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_corrections` ADD CONSTRAINT `transcript_corrections_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent nullable unique-key bypass for any unfinished recording.
ALTER TABLE `consultation_recordings` ADD CONSTRAINT `recording_active_key_state_check` CHECK (
  (`status` IN ('CREATED', 'RECORDING', 'PAUSED', 'STOPPED', 'UPLOADING') AND `active_key` IS NOT NULL)
  OR (`status` IN ('READY', 'ABORTED', 'FAILED') AND `active_key` IS NULL)
);
