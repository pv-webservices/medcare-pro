-- Platform-owned inventory for numbers rented on the shared Plivo account.
-- clinic_telephony_configs.plivo_number remains an additive compatibility mirror.
CREATE TABLE `platform_plivo_numbers` (
    `id` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(16) NOT NULL,
    `provider_application_id` VARCHAR(64) NULL,
    `provider_application_name` VARCHAR(100) NULL,
    `provider_number_type` VARCHAR(32) NULL,
    `provider_region` VARCHAR(100) NULL,
    `provider_present` BOOLEAN NOT NULL DEFAULT false,
    `assignment_status` ENUM('AVAILABLE', 'ASSIGNED', 'QUARANTINED') NOT NULL DEFAULT 'AVAILABLE',
    `health_status` ENUM('HEALTHY', 'OUT_OF_SYNC', 'MISSING_FROM_PROVIDER') NOT NULL DEFAULT 'MISSING_FROM_PROVIDER',
    `assigned_tenant_id` VARCHAR(191) NULL,
    `assigned_clinic_id` VARCHAR(191) NULL,
    `assigned_at` DATETIME(3) NULL,
    `quarantined_at` DATETIME(3) NULL,
    `quarantined_until` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `provider_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_plivo_numbers_phone_number_key`(`phone_number`),
    UNIQUE INDEX `platform_plivo_numbers_assigned_clinic_id_key`(`assigned_clinic_id`),
    INDEX `platform_plivo_numbers_assignment_status_idx`(`assignment_status`),
    INDEX `platform_plivo_numbers_health_status_idx`(`health_status`),
    INDEX `platform_plivo_numbers_assigned_tenant_id_idx`(`assigned_tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_plivo_numbers`
    ADD CONSTRAINT `platform_plivo_numbers_assigned_tenant_id_fkey`
    FOREIGN KEY (`assigned_tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `platform_plivo_numbers`
    ADD CONSTRAINT `platform_plivo_numbers_assigned_clinic_id_fkey`
    FOREIGN KEY (`assigned_clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
