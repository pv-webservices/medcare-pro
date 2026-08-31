-- Stage 7: safe-default reception routing modes and regular weekly hours.
-- Existing telephony configurations remain on the deterministic IVR.

ALTER TABLE `clinic_telephony_configs`
    ADD COLUMN `routing_mode` ENUM('AUTO', 'OPEN', 'AFTER_HOURS') NOT NULL DEFAULT 'AFTER_HOURS';

CREATE TABLE `clinic_business_hours` (
    `id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `day_of_week` ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY') NOT NULL,
    `is_closed` BOOLEAN NOT NULL DEFAULT true,
    `open_time` VARCHAR(5) NULL,
    `close_time` VARCHAR(5) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_business_hours_clinic_day_key`(`clinic_id`, `day_of_week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_business_hours`
    ADD CONSTRAINT `clinic_business_hours_clinic_id_fkey`
    FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
