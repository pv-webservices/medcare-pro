-- Per-clinic inbound voice routing. Provider credentials remain environment
-- secrets and are intentionally absent from this table.
CREATE TABLE `clinic_telephony_configs` (
    `id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `plivo_number` VARCHAR(16) NULL,
    `public_phone_number` VARCHAR(16) NULL,
    `reception_phone_number` VARCHAR(16) NULL,
    `urgent_phone_number` VARCHAR(16) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_telephony_configs_clinic_id_key`(`clinic_id`),
    UNIQUE INDEX `clinic_telephony_configs_plivo_number_key`(`plivo_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_telephony_configs` ADD CONSTRAINT `clinic_telephony_configs_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
