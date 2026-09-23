-- CreateTable
CREATE TABLE `transcript_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `transcript_version` INTEGER NOT NULL,
    `effective_hash` CHAR(64) NOT NULL,
    `reviewed_by_user_id` VARCHAR(191) NOT NULL,
    `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transcript_reviews_tenant_id_clinic_id_reviewed_at_idx`(`tenant_id`, `clinic_id`, `reviewed_at`),
    UNIQUE INDEX `transcript_reviews_transcript_id_transcript_version_key`(`transcript_id`, `transcript_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transcript_reviews` ADD CONSTRAINT `transcript_reviews_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_reviews` ADD CONSTRAINT `transcript_reviews_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_reviews` ADD CONSTRAINT `transcript_reviews_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_reviews` ADD CONSTRAINT `transcript_reviews_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_reviews` ADD CONSTRAINT `transcript_reviews_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A review snapshot records exactly what a clinician attested. It is
-- append-only and bound to its transcript's scope and current version.
CREATE TRIGGER transcript_review_binding BEFORE INSERT ON transcript_reviews
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clinical_transcripts t
    WHERE t.id = NEW.transcript_id
      AND t.tenant_id = NEW.tenant_id
      AND t.clinic_id = NEW.clinic_id
      AND t.registration_id = NEW.registration_id
      AND t.version = NEW.transcript_version
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transcript review must match its transcript scope and current version';
  END IF;
END;

CREATE TRIGGER transcript_review_append_only BEFORE UPDATE ON transcript_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only transcript review';
CREATE TRIGGER transcript_review_no_delete BEFORE DELETE ON transcript_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only transcript review';
