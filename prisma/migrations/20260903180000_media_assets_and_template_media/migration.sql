-- Additive migration for Local Media Upload and Template Media Attachments

CREATE TABLE `media_assets` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `uploaded_by_user_id` VARCHAR(191) NOT NULL,
    `original_file_name` VARCHAR(191) NOT NULL,
    `stored_file_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `media_type` ENUM('IMAGE', 'VIDEO', 'DOCUMENT') NOT NULL,
    `file_size` INTEGER NOT NULL,
    `storage_path` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(191) NULL,
    `last_used_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `media_assets_tenant_id_clinic_id_idx`(`tenant_id`, `clinic_id`),
    INDEX `media_assets_created_at_idx`(`created_at`),
    INDEX `media_assets_media_type_idx`(`media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_template_media` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `media_asset_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `whatsapp_template_media_tenant_id_clinic_id_idx`(`tenant_id`, `clinic_id`),
    INDEX `whatsapp_template_media_media_asset_id_idx`(`media_asset_id`),
    INDEX `whatsapp_template_media_template_id_idx`(`template_id`),
    UNIQUE INDEX `whatsapp_template_media_template_id_clinic_id_key`(`template_id`, `clinic_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_messages` ADD COLUMN `media_asset_id` VARCHAR(191) NULL;
CREATE INDEX `whatsapp_messages_media_asset_id_idx` ON `whatsapp_messages`(`media_asset_id`);

ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `whatsapp_template_media` ADD CONSTRAINT `whatsapp_template_media_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_template_media` ADD CONSTRAINT `whatsapp_template_media_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_template_media` ADD CONSTRAINT `whatsapp_template_media_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `whatsapp_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_template_media` ADD CONSTRAINT `whatsapp_template_media_media_asset_id_fkey` FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `whatsapp_messages` ADD CONSTRAINT `whatsapp_messages_media_asset_id_fkey` FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
