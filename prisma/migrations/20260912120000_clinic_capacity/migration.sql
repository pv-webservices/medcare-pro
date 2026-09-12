-- Clinic capacity is additive: existing clinics and tenant assignments are not
-- modified. Every existing plan receives the commercial baseline of 2 through
-- the column default; future changes are explicit platform decisions.

ALTER TABLE `plans`
  ADD COLUMN `included_clinics` INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN `additional_clinic_price` DECIMAL(10, 2) NULL,
  ADD COLUMN `additional_clinic_currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN `additional_clinic_billing_interval` ENUM('MONTHLY', 'YEARLY', 'ONE_TIME') NULL;

ALTER TABLE `plans`
  ADD CONSTRAINT `plans_included_clinics_check` CHECK (`included_clinics` >= 1),
  ADD CONSTRAINT `plans_additional_clinic_price_check` CHECK (`additional_clinic_price` IS NULL OR `additional_clinic_price` > 0);

CREATE TABLE `clinic_capacity_requests` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `requested_by_id` VARCHAR(191) NOT NULL,
  `request_type` ENUM('ADDITIONAL_CLINIC', 'PLAN_UPGRADE') NOT NULL,
  `requested_quantity` INTEGER NULL,
  `requested_plan_id` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `unit_price_snapshot` DECIMAL(10, 2) NULL,
  `currency` VARCHAR(3) NULL,
  `billing_interval` ENUM('MONTHLY', 'YEARLY', 'ONE_TIME') NULL,
  `payment_status` ENUM('NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'WAIVED', 'FAILED') NOT NULL DEFAULT 'NOT_REQUIRED',
  `payment_reference` VARCHAR(255) NULL,
  `organization_note` TEXT NULL,
  `review_note` TEXT NULL,
  `reviewed_by_id` VARCHAR(191) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `clinic_capacity_requests_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
  INDEX `clinic_capacity_requests_request_type_status_created_at_idx`(`request_type`, `status`, `created_at`),
  INDEX `clinic_capacity_requests_requested_by_id_idx`(`requested_by_id`),
  INDEX `clinic_capacity_requests_requested_plan_id_idx`(`requested_plan_id`),
  INDEX `clinic_capacity_requests_reviewed_by_id_idx`(`reviewed_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_capacity_requests`
  ADD CONSTRAINT `clinic_capacity_requests_target_check` CHECK (
    (`request_type` = 'ADDITIONAL_CLINIC' AND `requested_quantity` IS NOT NULL AND `requested_quantity` >= 1 AND `requested_plan_id` IS NULL)
    OR
    (`request_type` = 'PLAN_UPGRADE' AND `requested_quantity` IS NULL AND `requested_plan_id` IS NOT NULL)
  );

CREATE TABLE `tenant_clinic_capacity_grants` (
  `id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `type` ENUM('PAID_ADDON', 'COMPLIMENTARY', 'ENTERPRISE', 'MIGRATION') NOT NULL,
  `status` ENUM('ACTIVE', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  `source_request_id` VARCHAR(191) NULL,
  `approved_by_id` VARCHAR(191) NOT NULL,
  `approved_at` DATETIME(3) NOT NULL,
  `reason` TEXT NOT NULL,
  `unit_price_snapshot` DECIMAL(10, 2) NULL,
  `currency` VARCHAR(3) NULL,
  `billing_interval` ENUM('MONTHLY', 'YEARLY', 'ONE_TIME') NULL,
  `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `revoked_by_id` VARCHAR(191) NULL,
  `revocation_reason` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `tenant_clinic_capacity_grants_source_request_id_key`(`source_request_id`),
  INDEX `clinic_capacity_grants_tenant_status_dates_idx`(`tenant_id`, `status`, `starts_at`, `expires_at`),
  INDEX `tenant_clinic_capacity_grants_approved_by_id_idx`(`approved_by_id`),
  INDEX `tenant_clinic_capacity_grants_revoked_by_id_idx`(`revoked_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_clinic_capacity_grants`
  ADD CONSTRAINT `tenant_clinic_capacity_grants_quantity_check` CHECK (`quantity` >= 1),
  ADD CONSTRAINT `tenant_clinic_capacity_grants_dates_check` CHECK (`expires_at` IS NULL OR `expires_at` > `starts_at`),
  ADD CONSTRAINT `tenant_clinic_capacity_grants_price_check` CHECK (`unit_price_snapshot` IS NULL OR `unit_price_snapshot` > 0);

ALTER TABLE `clinic_capacity_requests`
  ADD CONSTRAINT `clinic_capacity_requests_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `clinic_capacity_requests_requested_by_id_fkey`
  FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `clinic_capacity_requests_requested_plan_id_fkey`
  FOREIGN KEY (`requested_plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `clinic_capacity_requests_reviewed_by_id_fkey`
  FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `tenant_clinic_capacity_grants`
  ADD CONSTRAINT `tenant_clinic_capacity_grants_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `tenant_clinic_capacity_grants_source_request_id_fkey`
  FOREIGN KEY (`source_request_id`) REFERENCES `clinic_capacity_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `tenant_clinic_capacity_grants_approved_by_id_fkey`
  FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `tenant_clinic_capacity_grants_revoked_by_id_fkey`
  FOREIGN KEY (`revoked_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
