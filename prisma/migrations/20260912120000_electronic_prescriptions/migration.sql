-- AlterTable
ALTER TABLE `doctors` ADD COLUMN `medical_registration_number` VARCHAR(255) NULL,
    ADD COLUMN `qualification` VARCHAR(255) NULL,
    ADD COLUMN `registration_council` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `clinical_consultations` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `consultation_mode` ENUM('IN_PERSON', 'VIDEO', 'AUDIO', 'TEXT') NOT NULL DEFAULT 'IN_PERSON',
    `chief_complaint` TEXT NOT NULL DEFAULT '',
    `history_of_present_illness` TEXT NOT NULL,
    `past_medical_history` TEXT NOT NULL,
    `examination_findings` TEXT NOT NULL,
    `investigation_notes` TEXT NOT NULL,
    `diagnosis` TEXT NOT NULL,
    `advice` TEXT NOT NULL,
    `follow_up_instructions` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'FINALIZED') NOT NULL DEFAULT 'DRAFT',
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinical_consultations_registration_id_key`(`registration_id`),
    INDEX `clinical_consultations_tenant_id_clinic_id_idx`(`tenant_id`, `clinic_id`),
    INDEX `clinical_consultations_patient_id_idx`(`patient_id`),
    INDEX `clinical_consultations_doctor_id_idx`(`doctor_id`),
    INDEX `clinical_consultations_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prescriptions` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `consultation_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `prescription_number` VARCHAR(64) NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'SUPERSEDED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `active_draft_key` VARCHAR(191) NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `clinical_json` JSON NOT NULL,
    `snapshot_json` JSON NULL,
    `issued_at` DATETIME(3) NULL,
    `issued_by_user_id` VARCHAR(191) NULL,
    `supersedes_prescription_id` VARCHAR(191) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_id` VARCHAR(191) NULL,
    `cancellation_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prescriptions_prescription_number_key`(`prescription_number`),
    UNIQUE INDEX `prescriptions_active_draft_key_key`(`active_draft_key`),
    UNIQUE INDEX `prescriptions_supersedes_prescription_id_key`(`supersedes_prescription_id`),
    INDEX `prescriptions_tenant_id_clinic_id_status_issued_at_idx`(`tenant_id`, `clinic_id`, `status`, `issued_at`),
    INDEX `prescriptions_tenant_id_patient_id_issued_at_idx`(`tenant_id`, `patient_id`, `issued_at`),
    INDEX `prescriptions_registration_id_idx`(`registration_id`),
    INDEX `prescriptions_doctor_id_issued_at_idx`(`doctor_id`, `issued_at`),
    INDEX `prescriptions_issued_by_user_id_idx`(`issued_by_user_id`),
    INDEX `prescriptions_cancelled_by_id_idx`(`cancelled_by_id`),
    UNIQUE INDEX `prescriptions_consultation_id_version_key`(`consultation_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prescription_items` (
    `id` VARCHAR(191) NOT NULL,
    `prescription_id` VARCHAR(191) NOT NULL,
    `medicine_generic_name` VARCHAR(255) NOT NULL,
    `brand_name` VARCHAR(255) NOT NULL,
    `dosage_form` VARCHAR(100) NOT NULL,
    `strength` VARCHAR(100) NOT NULL,
    `dose` VARCHAR(100) NOT NULL,
    `route` VARCHAR(100) NOT NULL,
    `frequency` VARCHAR(100) NOT NULL,
    `timing` VARCHAR(100) NOT NULL,
    `duration_value` INTEGER NULL,
    `duration_unit` VARCHAR(50) NOT NULL,
    `quantity` INTEGER NULL,
    `instructions` TEXT NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prescription_items_prescription_id_sort_order_key`(`prescription_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinical_consultations` ADD CONSTRAINT `clinical_consultations_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_consultation_id_fkey` FOREIGN KEY (`consultation_id`) REFERENCES `clinical_consultations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_issued_by_user_id_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_supersedes_prescription_id_fkey` FOREIGN KEY (`supersedes_prescription_id`) REFERENCES `prescriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prescription_items` ADD CONSTRAINT `prescription_items_prescription_id_fkey` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
