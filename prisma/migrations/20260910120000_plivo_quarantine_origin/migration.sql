-- Preserve the previous clinic ownership while a Platform Plivo number is quarantined.
-- These nullable fields are recovery metadata only and never participate in inbound routing.
ALTER TABLE `platform_plivo_numbers`
    ADD COLUMN `quarantine_source_tenant_id` VARCHAR(191) NULL,
    ADD COLUMN `quarantine_source_clinic_id` VARCHAR(191) NULL,
    ADD COLUMN `quarantine_source_telephony_enabled` BOOLEAN NULL;

CREATE INDEX `platform_plivo_numbers_quarantine_source_tenant_id_idx`
    ON `platform_plivo_numbers`(`quarantine_source_tenant_id`);

CREATE INDEX `platform_plivo_numbers_quarantine_source_clinic_id_idx`
    ON `platform_plivo_numbers`(`quarantine_source_clinic_id`);

ALTER TABLE `platform_plivo_numbers`
    ADD CONSTRAINT `platform_plivo_numbers_quarantine_source_tenant_id_fkey`
    FOREIGN KEY (`quarantine_source_tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `platform_plivo_numbers`
    ADD CONSTRAINT `platform_plivo_numbers_quarantine_source_clinic_id_fkey`
    FOREIGN KEY (`quarantine_source_clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
