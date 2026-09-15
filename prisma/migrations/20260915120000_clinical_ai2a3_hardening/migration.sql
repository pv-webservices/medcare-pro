-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `allow_gemini_transcription_fallback` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `consultation_recordings` ADD COLUMN `audio_cleanup_lease_expires_at` DATETIME(3) NULL,
    ADD COLUMN `audio_cleanup_next_attempt_at` DATETIME(3) NULL,
    ADD COLUMN `audio_cleanup_token` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `transcription_runs` ADD COLUMN `fallback_key` VARCHAR(191) NULL,
    ADD COLUMN `provider_artifact_delete_pending_at` DATETIME(3) NULL,
    ADD COLUMN `provider_artifact_deleted_at` DATETIME(3) NULL,
    ADD COLUMN `provider_artifact_name` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `transcript_derived_views` (
    `id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT 'ROMANIZED',
    `provider` VARCHAR(32) NOT NULL DEFAULT 'SARVAM',
    `status` VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    `is_partial` BOOLEAN NOT NULL DEFAULT false,
    `created_by_user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `lease_token` CHAR(36) NULL,
    `lease_expires_at` DATETIME(3) NULL,

    INDEX `derived_queue_idx`(`status`, `lease_expires_at`),
    UNIQUE INDEX `derived_source_type_key`(`transcript_id`, `source_hash`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcript_derived_segments` (
    `id` VARCHAR(191) NOT NULL,
    `derived_view_id` VARCHAR(191) NOT NULL,
    `source_segment_id` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `source_language_code` VARCHAR(32) NULL,

    INDEX `derived_segment_source_idx`(`source_segment_id`),
    UNIQUE INDEX `derived_segment_key`(`derived_view_id`, `source_segment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `transcription_runs_fallback_key_key` ON `transcription_runs`(`fallback_key`);

-- CreateIndex
CREATE INDEX `transcription_artifact_cleanup_idx` ON `transcription_runs`(`provider_artifact_delete_pending_at`, `provider_artifact_deleted_at`);

-- AddForeignKey
ALTER TABLE `transcript_derived_views` ADD CONSTRAINT `transcript_derived_views_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_derived_segments` ADD CONSTRAINT `transcript_derived_segments_derived_view_id_fkey` FOREIGN KEY (`derived_view_id`) REFERENCES `transcript_derived_views`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_derived_segments` ADD CONSTRAINT `transcript_derived_segments_source_segment_id_fkey` FOREIGN KEY (`source_segment_id`) REFERENCES `clinical_transcript_segments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE transcript_derived_views ADD CONSTRAINT derived_view_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER derived_segment_owner_guard BEFORE INSERT ON transcript_derived_segments
FOR EACH ROW BEGIN
  IF NOT EXISTS (SELECT 1 FROM transcript_derived_views v JOIN clinical_transcript_segments s ON s.transcript_id = v.transcript_id WHERE v.id = NEW.derived_view_id AND s.id = NEW.source_segment_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Derived segment must belong to view source';
  END IF;
END;
CREATE TRIGGER derived_view_source_guard BEFORE INSERT ON transcript_derived_views
FOR EACH ROW BEGIN
  IF NOT EXISTS (SELECT 1 FROM clinical_transcripts t JOIN users u ON u.tenant_id = t.tenant_id WHERE t.id = NEW.transcript_id AND BINARY t.source_hash = BINARY NEW.source_hash AND u.id = NEW.created_by_user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Derived view requires same-tenant immutable source';
  END IF;
END;
CREATE TRIGGER derived_segment_identity_guard BEFORE UPDATE ON transcript_derived_segments
FOR EACH ROW BEGIN
  IF NOT (NEW.derived_view_id <=> OLD.derived_view_id) OR NOT (NEW.source_segment_id <=> OLD.source_segment_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Derived source binding is immutable';
  END IF;
END;
CREATE TRIGGER derived_view_identity_guard BEFORE UPDATE ON transcript_derived_views
FOR EACH ROW BEGIN
  IF NOT (NEW.transcript_id <=> OLD.transcript_id) OR NOT (BINARY NEW.source_hash <=> BINARY OLD.source_hash) OR NOT (NEW.created_by_user_id <=> OLD.created_by_user_id) OR NOT (NEW.type <=> OLD.type) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Derived source binding is immutable';
  END IF;
END;
