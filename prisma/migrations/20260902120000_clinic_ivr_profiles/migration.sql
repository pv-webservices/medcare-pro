-- Phase 2A: dormant, clinic-specific IVR configuration. The live Plivo
-- answer/input paths continue using the existing deterministic static menu.

CREATE TABLE `clinic_ivr_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `greeting_template` VARCHAR(500) NOT NULL,
    `language` VARCHAR(16) NOT NULL,
    `voice` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_ivr_profiles_clinic_id_key`(`clinic_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clinic_ivr_menu_items` (
    `id` VARCHAR(191) NOT NULL,
    `profile_id` VARCHAR(191) NOT NULL,
    `digit` INTEGER NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `action` ENUM('TOMORROW_SLOTS', 'APPOINTMENT_BOOKING', 'URGENT_ASSISTANCE', 'CLINIC_INFORMATION') NOT NULL,
    `position` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_ivr_menu_items_profile_id_digit_key`(`profile_id`, `digit`),
    UNIQUE INDEX `clinic_ivr_menu_items_profile_id_position_key`(`profile_id`, `position`),
    UNIQUE INDEX `clinic_ivr_menu_items_profile_id_action_key`(`profile_id`, `action`),
    CONSTRAINT `clinic_ivr_menu_items_digit_check` CHECK (`digit` BETWEEN 1 AND 7),
    CONSTRAINT `clinic_ivr_menu_items_position_check` CHECK (`position` BETWEEN 0 AND 6),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_ivr_profiles`
    ADD CONSTRAINT `clinic_ivr_profiles_clinic_id_fkey`
    FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `clinic_ivr_menu_items`
    ADD CONSTRAINT `clinic_ivr_menu_items_profile_id_fkey`
    FOREIGN KEY (`profile_id`) REFERENCES `clinic_ivr_profiles`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
