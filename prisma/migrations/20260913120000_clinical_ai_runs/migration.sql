-- CreateTable
CREATE TABLE `ai_runs` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(64) NOT NULL,
    `field` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(32) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(101) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `input_character_count` INTEGER NOT NULL,
    `output_character_count` INTEGER NOT NULL DEFAULT 0,
    `input_tokens` INTEGER NULL,
    `output_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_runs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `ai_runs_tenant_id_user_id_created_at_idx`(`tenant_id`, `user_id`, `created_at`),
    INDEX `ai_runs_tenant_id_registration_id_created_at_idx`(`tenant_id`, `registration_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
