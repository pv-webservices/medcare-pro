-- Tenant-owned RkvRobo accounts and deterministic device routing.
-- There is intentionally no UNIQUE(tenant_id) on provider accounts: one
-- organisation may own several separately purchased RkvRobo accounts.

ALTER TABLE `clinics`
  ADD UNIQUE INDEX `clinics_id_tenant_id_key`(`id`, `tenant_id`);

CREATE TABLE `whatsapp_provider_accounts` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `api_base_url` VARCHAR(191) NOT NULL DEFAULT 'https://bot.rkvrobo.in/api',
  `encrypted_api_key` TEXT NOT NULL,
  `key_version` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `whatsapp_provider_accounts_id_tenant_id_key`(`id`, `tenant_id`),
  UNIQUE INDEX `whatsapp_provider_accounts_tenant_id_name_key`(`tenant_id`, `name`),
  INDEX `whatsapp_provider_accounts_tenant_id_enabled_idx`(`tenant_id`, `enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_devices` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `provider_account_id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `phone_number` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `whatsapp_devices_id_tenant_id_key`(`id`, `tenant_id`),
  UNIQUE INDEX `whatsapp_devices_provider_account_id_phone_number_key`(`provider_account_id`, `phone_number`),
  INDEX `whatsapp_devices_tenant_id_enabled_idx`(`tenant_id`, `enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_whatsapp_settings` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `default_device_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `tenant_whatsapp_settings_tenant_id_key`(`tenant_id`),
  INDEX `tenant_whatsapp_settings_default_device_id_tenant_id_idx`(`default_device_id`, `tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clinic_whatsapp_settings` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `clinic_id` VARCHAR(191) NOT NULL,
  `device_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `clinic_whatsapp_settings_clinic_id_key`(`clinic_id`),
  UNIQUE INDEX `clinic_whatsapp_settings_clinic_id_tenant_id_key`(`clinic_id`, `tenant_id`),
  INDEX `clinic_whatsapp_settings_tenant_id_idx`(`tenant_id`),
  INDEX `clinic_whatsapp_settings_device_id_tenant_id_idx`(`device_id`, `tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_provider_accounts`
  ADD CONSTRAINT `whatsapp_provider_accounts_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `whatsapp_devices`
  ADD CONSTRAINT `whatsapp_devices_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `whatsapp_devices_provider_account_id_tenant_id_fkey`
  FOREIGN KEY (`provider_account_id`, `tenant_id`) REFERENCES `whatsapp_provider_accounts`(`id`, `tenant_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `tenant_whatsapp_settings`
  ADD CONSTRAINT `tenant_whatsapp_settings_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `tenant_whatsapp_settings_default_device_id_tenant_id_fkey`
  FOREIGN KEY (`default_device_id`, `tenant_id`) REFERENCES `whatsapp_devices`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `clinic_whatsapp_settings`
  ADD CONSTRAINT `clinic_whatsapp_settings_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `clinic_whatsapp_settings_clinic_id_tenant_id_fkey`
  FOREIGN KEY (`clinic_id`, `tenant_id`) REFERENCES `clinics`(`id`, `tenant_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `clinic_whatsapp_settings_device_id_tenant_id_fkey`
  FOREIGN KEY (`device_id`, `tenant_id`) REFERENCES `whatsapp_devices`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `whatsapp_messages`
  ADD COLUMN `whatsapp_device_id` VARCHAR(191) NULL,
  ADD INDEX `whatsapp_messages_whatsapp_device_id_idx`(`whatsapp_device_id`),
  ADD CONSTRAINT `whatsapp_messages_whatsapp_device_id_fkey`
  FOREIGN KEY (`whatsapp_device_id`) REFERENCES `whatsapp_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
