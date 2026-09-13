-- CreateTable
CREATE TABLE `patient_portal_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `mobile_e164` VARCHAR(16) NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `verified_at` DATETIME(3) NOT NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `patient_portal_accounts_mobile_e164_key`(`mobile_e164`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_portal_links` (
    `id` VARCHAR(191) NOT NULL,
    `portal_account_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `active_patient_id` VARCHAR(191) NULL,
    `active_account_id` VARCHAR(191) NULL,
    `access_type` ENUM('SELF') NOT NULL DEFAULT 'SELF',
    `verified_at` DATETIME(3) NOT NULL,
    `identity_verified_by_user_id` VARCHAR(191) NULL,
    `identity_verified_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `patient_portal_links_active_patient_id_key`(`active_patient_id`),
    UNIQUE INDEX `patient_portal_links_active_account_id_key`(`active_account_id`),
    INDEX `patient_portal_links_patient_id_tenant_id_idx`(`patient_id`, `tenant_id`),
    INDEX `patient_portal_links_portal_account_id_idx`(`portal_account_id`),
    UNIQUE INDEX `patient_portal_links_id_portal_account_id_key`(`id`, `portal_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_portal_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `portal_account_id` VARCHAR(191) NOT NULL,
    `link_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NULL,

    UNIQUE INDEX `patient_portal_sessions_token_hash_key`(`token_hash`),
    INDEX `patient_portal_sessions_portal_account_id_revoked_at_idx`(`portal_account_id`, `revoked_at`),
    INDEX `patient_portal_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_portal_activations` (
    `id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `active_patient_id` VARCHAR(191) NULL,
    `mobile_e164` VARCHAR(16) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_by_user_id` VARCHAR(191) NULL,
    `identity_verified_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `patient_portal_activations_active_patient_id_key`(`active_patient_id`),
    UNIQUE INDEX `patient_portal_activations_token_hash_key`(`token_hash`),
    INDEX `patient_portal_activations_patient_id_tenant_id_idx`(`patient_id`, `tenant_id`),
    INDEX `patient_portal_activations_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_portal_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `portal_account_id` VARCHAR(191) NULL,
    `activation_id` VARCHAR(191) NULL,
    `mobile_e164` VARCHAR(16) NOT NULL,
    `purpose` ENUM('ACTIVATION', 'LOGIN') NOT NULL,
    `code_digest` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 5,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `patient_portal_challenges_mobile_e164_purpose_created_at_idx`(`mobile_e164`, `purpose`, `created_at`),
    INDEX `patient_portal_challenges_activation_id_idx`(`activation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_portal_audit_events` (
    `id` VARCHAR(191) NOT NULL,
    `portal_account_id` VARCHAR(191) NULL,
    `tenant_id` VARCHAR(191) NULL,
    `event` VARCHAR(64) NOT NULL,
    `resource_id` VARCHAR(191) NULL,
    `status` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `patient_portal_audit_events_portal_account_id_created_at_idx`(`portal_account_id`, `created_at`),
    INDEX `patient_portal_audit_events_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `patients_id_tenant_id_key` ON `patients`(`id`, `tenant_id`);

-- AddForeignKey
ALTER TABLE `patient_portal_links` ADD CONSTRAINT `patient_portal_links_portal_account_id_fkey` FOREIGN KEY (`portal_account_id`) REFERENCES `patient_portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_links` ADD CONSTRAINT `patient_portal_links_patient_id_tenant_id_fkey` FOREIGN KEY (`patient_id`, `tenant_id`) REFERENCES `patients`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_links` ADD CONSTRAINT `patient_portal_links_identity_verified_by_user_id_fkey` FOREIGN KEY (`identity_verified_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `patient_portal_links` ADD CONSTRAINT `patient_portal_links_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `patient_portal_sessions` ADD CONSTRAINT `patient_portal_sessions_portal_account_id_fkey` FOREIGN KEY (`portal_account_id`) REFERENCES `patient_portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_sessions` ADD CONSTRAINT `patient_portal_sessions_link_id_portal_account_id_fkey` FOREIGN KEY (`link_id`, `portal_account_id`) REFERENCES `patient_portal_links`(`id`, `portal_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_activations` ADD CONSTRAINT `patient_portal_activations_patient_id_tenant_id_fkey` FOREIGN KEY (`patient_id`, `tenant_id`) REFERENCES `patients`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_activations` ADD CONSTRAINT `patient_portal_activations_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `patient_portal_challenges` ADD CONSTRAINT `patient_portal_challenges_portal_account_id_fkey` FOREIGN KEY (`portal_account_id`) REFERENCES `patient_portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_challenges` ADD CONSTRAINT `patient_portal_challenges_activation_id_fkey` FOREIGN KEY (`activation_id`) REFERENCES `patient_portal_activations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_audit_events` ADD CONSTRAINT `patient_portal_audit_events_portal_account_id_fkey` FOREIGN KEY (`portal_account_id`) REFERENCES `patient_portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `patient_portal_audit_events` ADD CONSTRAINT `patient_portal_audit_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- MySQL/MariaDB NULL-distinct unique indexes enforce live cardinality.
-- CHECKs prevent NULL/forged live keys from bypassing those indexes.
ALTER TABLE patient_portal_links ADD CONSTRAINT portal_link_live_keys CHECK (
 (revoked_at IS NULL AND active_patient_id IS NOT NULL AND active_account_id IS NOT NULL AND active_patient_id = patient_id AND active_account_id = portal_account_id)
 OR (revoked_at IS NOT NULL AND active_patient_id IS NULL AND active_account_id IS NULL)
);
ALTER TABLE patient_portal_activations ADD CONSTRAINT portal_activation_live_key CHECK (
 (consumed_at IS NULL AND revoked_at IS NULL AND active_patient_id IS NOT NULL AND active_patient_id = patient_id)
 OR ((consumed_at IS NOT NULL OR revoked_at IS NOT NULL) AND active_patient_id IS NULL)
);
ALTER TABLE patient_portal_challenges ADD CONSTRAINT portal_challenge_subject CHECK (
 (purpose = 'ACTIVATION' AND activation_id IS NOT NULL AND portal_account_id IS NULL)
 OR (purpose = 'LOGIN' AND portal_account_id IS NOT NULL AND activation_id IS NULL)
);
ALTER TABLE patient_portal_challenges ADD CONSTRAINT portal_challenge_attempt_bounds CHECK (
 attempt_count >= 0 AND max_attempts BETWEEN 1 AND 5 AND attempt_count <= max_attempts
);

