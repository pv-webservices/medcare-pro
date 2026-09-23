-- CreateTable
CREATE TABLE `clinical_fact_extraction_runs` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `transcript_id` VARCHAR(191) NOT NULL,
    `transcript_review_id` VARCHAR(191) NOT NULL,
    `effective_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    `failure_code` VARCHAR(64) NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(101) NOT NULL,
    `prompt_version` VARCHAR(32) NOT NULL,
    `schema_version` VARCHAR(32) NOT NULL,
    `chunk_count` INTEGER NOT NULL DEFAULT 0,
    `candidate_count` INTEGER NOT NULL DEFAULT 0,
    `rejected_count` INTEGER NOT NULL DEFAULT 0,
    `rejection_counts` JSON NULL,
    `attempt_number` INTEGER NOT NULL DEFAULT 1,
    `next_attempt_at` DATETIME(3) NULL,
    `active_key` VARCHAR(191) NULL,
    `idempotency_key` CHAR(64) NOT NULL,
    `lease_token` CHAR(36) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `requested_by_user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `clinical_fact_extraction_runs_active_key_key`(`active_key`),
    UNIQUE INDEX `clinical_fact_extraction_runs_idempotency_key_key`(`idempotency_key`),
    INDEX `fact_extraction_queue_idx`(`status`, `next_attempt_at`, `lease_expires_at`),
    INDEX `fact_extraction_transcript_idx`(`tenant_id`, `transcript_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinical_fact_candidates` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `extraction_run_id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `assertion` VARCHAR(16) NOT NULL,
    `subject` VARCHAR(16) NOT NULL,
    `statement` VARCHAR(500) NOT NULL,
    `attributes` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `clinical_fact_candidates_extraction_run_id_idx`(`extraction_run_id`),
    INDEX `clinical_fact_candidates_tenant_id_registration_id_idx`(`tenant_id`, `registration_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinical_fact_evidence` (
    `id` VARCHAR(191) NOT NULL,
    `fact_id` VARCHAR(191) NOT NULL,
    `segment_id` VARCHAR(191) NOT NULL,
    `correction_id` VARCHAR(191) NULL,
    `speaker_type` VARCHAR(32) NOT NULL,
    `quote` VARCHAR(300) NOT NULL,
    `char_start` INTEGER NOT NULL,
    `char_end` INTEGER NOT NULL,

    INDEX `clinical_fact_evidence_fact_id_idx`(`fact_id`),
    INDEX `clinical_fact_evidence_segment_id_idx`(`segment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinical_fact_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `fact_id` VARCHAR(191) NOT NULL,
    `decision` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `reviewed_by_user_id` VARCHAR(191) NOT NULL,
    `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `clinical_fact_reviews_fact_id_reviewed_at_idx`(`fact_id`, `reviewed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `clinical_transcripts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_transcript_review_id_fkey` FOREIGN KEY (`transcript_review_id`) REFERENCES `transcript_reviews`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_extraction_runs` ADD CONSTRAINT `clinical_fact_extraction_runs_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_candidates` ADD CONSTRAINT `clinical_fact_candidates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_candidates` ADD CONSTRAINT `clinical_fact_candidates_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_candidates` ADD CONSTRAINT `clinical_fact_candidates_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_candidates` ADD CONSTRAINT `clinical_fact_candidates_extraction_run_id_fkey` FOREIGN KEY (`extraction_run_id`) REFERENCES `clinical_fact_extraction_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_evidence` ADD CONSTRAINT `clinical_fact_evidence_fact_id_fkey` FOREIGN KEY (`fact_id`) REFERENCES `clinical_fact_candidates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_evidence` ADD CONSTRAINT `clinical_fact_evidence_segment_id_fkey` FOREIGN KEY (`segment_id`) REFERENCES `clinical_transcript_segments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_evidence` ADD CONSTRAINT `clinical_fact_evidence_correction_id_fkey` FOREIGN KEY (`correction_id`) REFERENCES `transcript_corrections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_reviews` ADD CONSTRAINT `clinical_fact_reviews_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_reviews` ADD CONSTRAINT `clinical_fact_reviews_fact_id_fkey` FOREIGN KEY (`fact_id`) REFERENCES `clinical_fact_candidates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_fact_reviews` ADD CONSTRAINT `clinical_fact_reviews_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- AI-3 integrity guards. Application code validates first; these make the
-- same guarantees hold for any writer.

-- A run binds to a review snapshot of the same transcript, scope and fingerprint.
CREATE TRIGGER fact_run_binding BEFORE INSERT ON clinical_fact_extraction_runs
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM transcript_reviews r
    WHERE r.id = NEW.transcript_review_id
      AND r.transcript_id = NEW.transcript_id
      AND r.tenant_id = NEW.tenant_id
      AND r.clinic_id = NEW.clinic_id
      AND r.registration_id = NEW.registration_id
      AND BINARY r.effective_hash = BINARY NEW.effective_hash
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fact extraction must bind to its transcript review';
  END IF;
END;

-- Status, counts and leases change; what a run is about never does.
CREATE TRIGGER fact_run_identity_immutable BEFORE UPDATE ON clinical_fact_extraction_runs
FOR EACH ROW
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.clinic_id <> OLD.clinic_id
     OR NEW.registration_id <> OLD.registration_id
     OR NEW.transcript_id <> OLD.transcript_id
     OR NEW.transcript_review_id <> OLD.transcript_review_id
     OR NOT (BINARY NEW.effective_hash <=> BINARY OLD.effective_hash)
     OR NOT (BINARY NEW.idempotency_key <=> BINARY OLD.idempotency_key)
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.provider <> OLD.provider
     OR NEW.model <> OLD.model
     OR NEW.prompt_version <> OLD.prompt_version
     OR NEW.schema_version <> OLD.schema_version THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable fact extraction identity';
  END IF;
END;
CREATE TRIGGER fact_run_no_delete BEFORE DELETE ON clinical_fact_extraction_runs
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fact extraction runs are retained';

CREATE TRIGGER fact_candidate_binding BEFORE INSERT ON clinical_fact_candidates
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clinical_fact_extraction_runs r
    WHERE r.id = NEW.extraction_run_id
      AND r.tenant_id = NEW.tenant_id
      AND r.clinic_id = NEW.clinic_id
      AND r.registration_id = NEW.registration_id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fact must match its extraction scope';
  END IF;
END;
CREATE TRIGGER fact_candidate_immutable BEFORE UPDATE ON clinical_fact_candidates
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable fact candidate';
CREATE TRIGGER fact_candidate_no_delete BEFORE DELETE ON clinical_fact_candidates
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable fact candidate';

-- Evidence must quote a segment (and correction) of the run's own transcript.
CREATE TRIGGER fact_evidence_binding BEFORE INSERT ON clinical_fact_evidence
FOR EACH ROW
BEGIN
  IF NEW.char_start < 0 OR NEW.char_end <= NEW.char_start OR NOT EXISTS (
    SELECT 1 FROM clinical_fact_candidates f
    JOIN clinical_fact_extraction_runs r ON r.id = f.extraction_run_id
    JOIN clinical_transcript_segments s ON s.id = NEW.segment_id AND s.transcript_id = r.transcript_id
    WHERE f.id = NEW.fact_id
  ) OR (NEW.correction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM transcript_corrections c
    WHERE c.id = NEW.correction_id AND c.segment_id = NEW.segment_id
  )) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fact evidence must reference its transcript';
  END IF;
END;
CREATE TRIGGER fact_evidence_immutable BEFORE UPDATE ON clinical_fact_evidence
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable fact evidence';
CREATE TRIGGER fact_evidence_no_delete BEFORE DELETE ON clinical_fact_evidence
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable fact evidence';

CREATE TRIGGER fact_review_binding BEFORE INSERT ON clinical_fact_reviews
FOR EACH ROW
BEGIN
  IF NEW.decision NOT IN ('ACCEPTED', 'DISMISSED') OR NOT EXISTS (
    SELECT 1 FROM clinical_fact_candidates f
    WHERE f.id = NEW.fact_id AND f.tenant_id = NEW.tenant_id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid fact review';
  END IF;
END;
CREATE TRIGGER fact_review_append_only BEFORE UPDATE ON clinical_fact_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only fact review';
CREATE TRIGGER fact_review_no_delete BEFORE DELETE ON clinical_fact_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only fact review';
