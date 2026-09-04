-- Additive completion of tenant WhatsApp provider management.
-- Existing default_device_id remains the organisation primary device.

ALTER TABLE `whatsapp_provider_accounts`
  ADD COLUMN `device_limit` INTEGER NOT NULL DEFAULT 2;

ALTER TABLE `whatsapp_devices`
  ADD COLUMN `connection_status` ENUM('PENDING', 'CONNECTED', 'DISCONNECTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `last_status_checked_at` DATETIME(3) NULL,
  ADD COLUMN `webhook_public_id` VARCHAR(191) NULL,
  ADD COLUMN `webhook_secret_hash` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `whatsapp_devices_webhook_public_id_key`(`webhook_public_id`),
  ADD UNIQUE INDEX `whatsapp_devices_tenant_id_phone_number_key`(`tenant_id`, `phone_number`);

ALTER TABLE `tenant_whatsapp_settings`
  ADD COLUMN `backup_device_id` VARCHAR(191) NULL,
  ADD COLUMN `automatic_failover` BOOLEAN NOT NULL DEFAULT false,
  ADD INDEX `tenant_whatsapp_settings_backup_device_id_tenant_id_idx`(`backup_device_id`, `tenant_id`),
  ADD CONSTRAINT `tenant_whatsapp_settings_backup_device_id_tenant_id_fkey`
    FOREIGN KEY (`backup_device_id`, `tenant_id`) REFERENCES `whatsapp_devices`(`id`, `tenant_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `whatsapp_messages`
  ADD COLUMN `sender_number` VARCHAR(191) NULL;
