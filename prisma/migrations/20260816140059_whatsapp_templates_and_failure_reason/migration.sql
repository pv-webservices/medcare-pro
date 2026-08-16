-- AlterTable
ALTER TABLE `whatsapp_messages` ADD COLUMN `failure_reason` TEXT NULL;

-- CreateTable
CREATE TABLE `whatsapp_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `footer` VARCHAR(191) NULL,
    `media_type` VARCHAR(191) NULL,
    `media_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `whatsapp_templates_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `whatsapp_templates_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `whatsapp_messages_clinic_id_sent_at_idx` ON `whatsapp_messages`(`clinic_id`, `sent_at`);

-- AddForeignKey
ALTER TABLE `whatsapp_templates` ADD CONSTRAINT `whatsapp_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
