-- MEDCARE PRO — Stage 1, migration 1 of 2: EXPAND
--
-- Purely additive. No DROP, no DELETE, no destructive UPDATE, and no constraint
-- that any existing row could violate:
--   * every new column on an existing table is NULLable or carries a DEFAULT;
--   * every new table starts empty, so its UNIQUE indexes are safe here;
--   * six columns that must end up NOT NULL (tenants.slug, tenants.updated_at,
--     users.updated_at, roles.created_at, roles.updated_at and
--     user_roles.created_at) are added NULLable on purpose. NULL is the signal
--     that a row has not been backfilled yet — which is also why
--     roles.created_at and user_roles.created_at deliberately carry NO default
--     here: MySQL would otherwise stamp every existing row with the migration
--     timestamp, which is not when those rows were actually created.
--
-- Existing UserRole rows are never deleted or rewritten; only the two new
-- nullable columns are added to them.
--
-- Run order:
--   1. this migration
--   2. npm run stage1:backfill   (localhost-guarded, idempotent)
--   3. npm run stage1:verify     (must pass before step 4)
--   4. the stage1_constrain migration
--
-- Not run against production.

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by_id` VARCHAR(191) NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `is_platform` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `plan_id` VARCHAR(191) NULL,
    ADD COLUMN `primary_contact_email` VARCHAR(191) NULL,
    ADD COLUMN `rejected_at` DATETIME(3) NULL,
    ADD COLUMN `rejected_by_id` VARCHAR(191) NULL,
    ADD COLUMN `rejection_reason` TEXT NULL,
    ADD COLUMN `slug` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'ARCHIVED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `suspended_at` DATETIME(3) NULL,
    ADD COLUMN `suspended_by_id` VARCHAR(191) NULL,
    ADD COLUMN `suspension_reason` TEXT NULL,
    ADD COLUMN `terms_accepted_at` DATETIME(3) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `account_status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by_id` VARCHAR(191) NULL,
    ADD COLUMN `email_verified_at` DATETIME(3) NULL,
    ADD COLUMN `last_login_at` DATETIME(3) NULL,
    ADD COLUMN `membership_status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'REMOVED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `platform_role` ENUM('SUPER_ADMIN', 'SUPPORT_ADMIN') NULL,
    ADD COLUMN `rejected_at` DATETIME(3) NULL,
    ADD COLUMN `rejected_by_id` VARCHAR(191) NULL,
    ADD COLUMN `rejection_reason` TEXT NULL,
    ADD COLUMN `removed_at` DATETIME(3) NULL,
    ADD COLUMN `suspended_at` DATETIME(3) NULL,
    ADD COLUMN `suspended_by_id` VARCHAR(191) NULL,
    ADD COLUMN `suspension_reason` TEXT NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `verification_tokens` ADD COLUMN `purpose` VARCHAR(191) NOT NULL DEFAULT 'TENANT_EMAIL';

-- AlterTable
ALTER TABLE `roles` ADD COLUMN `created_at` DATETIME(3) NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `is_system` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `key` VARCHAR(191) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `user_roles` ADD COLUMN `assigned_by_id` VARCHAR(191) NULL,
    ADD COLUMN `created_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `app_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `remember_me` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_id` VARCHAR(191) NULL,
    `revoke_reason` TEXT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,

    INDEX `app_sessions_user_id_idx`(`user_id`),
    INDEX `app_sessions_tenant_id_idx`(`tenant_id`),
    INDEX `app_sessions_expires_at_idx`(`expires_at`),
    INDEX `app_sessions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `app_sessions_revoked_by_id_idx`(`revoked_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_codes` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `code_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `request_ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_codes_user_id_consumed_at_idx`(`user_id`, `consumed_at`),
    INDEX `login_codes_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `role_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `status` ENUM('CREATED', 'OPENED', 'EXPIRED', 'REVOKED', 'ACCEPTED') NOT NULL DEFAULT 'CREATED',
    `expires_at` DATETIME(3) NOT NULL,
    `invited_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `opened_at` DATETIME(3) NULL,
    `accepted_at` DATETIME(3) NULL,
    `accepted_by_user_id` VARCHAR(191) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_id` VARCHAR(191) NULL,

    INDEX `invitations_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `invitations_email_idx`(`email`),
    INDEX `invitations_role_id_idx`(`role_id`),
    INDEX `invitations_clinic_id_idx`(`clinic_id`),
    INDEX `invitations_accepted_by_user_id_idx`(`accepted_by_user_id`),
    INDEX `invitations_invited_by_id_idx`(`invited_by_id`),
    INDEX `invitations_revoked_by_id_idx`(`revoked_by_id`),
    INDEX `invitations_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `invitations_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `features` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `tier` ENUM('CORE', 'PREMIUM', 'BETA', 'INTERNAL') NOT NULL DEFAULT 'CORE',
    `global_enabled` BOOLEAN NOT NULL DEFAULT true,
    `global_changed_by_id` VARCHAR(191) NULL,
    `global_changed_at` DATETIME(3) NULL,
    `global_change_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `features_tier_idx`(`tier`),
    INDEX `features_global_enabled_idx`(`global_enabled`),
    INDEX `features_global_changed_by_id_idx`(`global_changed_by_id`),
    UNIQUE INDEX `features_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_features` (
    `id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `plan_features_feature_id_idx`(`feature_id`),
    UNIQUE INDEX `plan_features_plan_id_feature_id_key`(`plan_id`, `feature_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_feature_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `reason` TEXT NOT NULL,
    `changed_by_id` VARCHAR(191) NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_feature_overrides_feature_id_idx`(`feature_id`),
    INDEX `tenant_feature_overrides_changed_by_id_idx`(`changed_by_id`),
    UNIQUE INDEX `tenant_feature_overrides_tenant_id_feature_id_key`(`tenant_id`, `feature_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_feature_access` (
    `id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `role_feature_access_feature_id_idx`(`feature_id`),
    UNIQUE INDEX `role_feature_access_role_id_feature_id_key`(`role_id`, `feature_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actor_user_id` VARCHAR(191) NULL,
    `actor_platform_role` ENUM('SUPER_ADMIN', 'SUPPORT_ADMIN') NULL,
    `actor_tenant_id` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(64) NOT NULL,
    `target_id` VARCHAR(191) NULL,
    `before_value` JSON NULL,
    `after_value` JSON NULL,
    `reason` TEXT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_actor_tenant_id_created_at_idx`(`actor_tenant_id`, `created_at`),
    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_actor_user_id_idx`(`actor_user_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limit_buckets` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `window_started_at` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `blocked_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rate_limit_buckets_blocked_until_idx`(`blocked_until`),
    INDEX `rate_limit_buckets_window_started_at_idx`(`window_started_at`),
    UNIQUE INDEX `rate_limit_buckets_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `tenants_status_idx` ON `tenants`(`status`);

-- CreateIndex
CREATE INDEX `tenants_is_platform_idx` ON `tenants`(`is_platform`);

-- CreateIndex
CREATE INDEX `tenants_plan_id_idx` ON `tenants`(`plan_id`);

-- CreateIndex
CREATE INDEX `tenants_approved_by_id_idx` ON `tenants`(`approved_by_id`);

-- CreateIndex
CREATE INDEX `tenants_rejected_by_id_idx` ON `tenants`(`rejected_by_id`);

-- CreateIndex
CREATE INDEX `tenants_suspended_by_id_idx` ON `tenants`(`suspended_by_id`);

-- CreateIndex
CREATE INDEX `users_account_status_idx` ON `users`(`account_status`);

-- CreateIndex
CREATE INDEX `users_membership_status_idx` ON `users`(`membership_status`);

-- CreateIndex
CREATE INDEX `users_platform_role_idx` ON `users`(`platform_role`);

-- CreateIndex
CREATE INDEX `users_approved_by_id_idx` ON `users`(`approved_by_id`);

-- CreateIndex
CREATE INDEX `users_rejected_by_id_idx` ON `users`(`rejected_by_id`);

-- CreateIndex
CREATE INDEX `users_suspended_by_id_idx` ON `users`(`suspended_by_id`);

-- CreateIndex
CREATE INDEX `verification_tokens_identifier_purpose_idx` ON `verification_tokens`(`identifier`, `purpose`);

-- CreateIndex
CREATE INDEX `user_roles_assigned_by_id_idx` ON `user_roles`(`assigned_by_id`);

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_rejected_by_id_fkey` FOREIGN KEY (`rejected_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_suspended_by_id_fkey` FOREIGN KEY (`suspended_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_rejected_by_id_fkey` FOREIGN KEY (`rejected_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_suspended_by_id_fkey` FOREIGN KEY (`suspended_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_assigned_by_id_fkey` FOREIGN KEY (`assigned_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_sessions` ADD CONSTRAINT `app_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_sessions` ADD CONSTRAINT `app_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_sessions` ADD CONSTRAINT `app_sessions_revoked_by_id_fkey` FOREIGN KEY (`revoked_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `login_codes` ADD CONSTRAINT `login_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_id_fkey` FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_revoked_by_id_fkey` FOREIGN KEY (`revoked_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_accepted_by_user_id_fkey` FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `features` ADD CONSTRAINT `features_global_changed_by_id_fkey` FOREIGN KEY (`global_changed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_feature_id_fkey` FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_overrides` ADD CONSTRAINT `tenant_feature_overrides_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_overrides` ADD CONSTRAINT `tenant_feature_overrides_feature_id_fkey` FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_overrides` ADD CONSTRAINT `tenant_feature_overrides_changed_by_id_fkey` FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_feature_access` ADD CONSTRAINT `role_feature_access_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_feature_access` ADD CONSTRAINT `role_feature_access_feature_id_fkey` FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_tenant_id_fkey` FOREIGN KEY (`actor_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

