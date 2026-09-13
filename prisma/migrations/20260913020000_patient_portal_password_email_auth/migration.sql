-- AlterTable
ALTER TABLE `patient_portal_accounts` ADD COLUMN `password_hash` VARCHAR(60) NULL,
    ADD COLUMN `password_set_at` DATETIME(3) NULL,
    ADD COLUMN `pending_recovery_email` VARCHAR(254) NULL,
    ADD COLUMN `recovery_email` VARCHAR(254) NULL,
    ADD COLUMN `recovery_email_verified_at` DATETIME(3) NULL,
    MODIFY `mobile_e164` VARCHAR(16) NULL;

-- AlterTable
ALTER TABLE `patient_portal_activations` ADD COLUMN `purpose` ENUM('LEGACY_SMS', 'INITIAL', 'REENABLE', 'STAFF_RECOVERY') NOT NULL DEFAULT 'LEGACY_SMS',
    MODIFY `mobile_e164` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `patient_portal_security_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `portal_account_id` VARCHAR(191) NOT NULL,
    `purpose` ENUM('VERIFY_RECOVERY_EMAIL', 'PASSWORD_RESET') NOT NULL,
    `email_snapshot` VARCHAR(254) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `patient_portal_security_tokens_token_hash_key`(`token_hash`),
    INDEX `patient_portal_security_tokens_portal_account_id_purpose_idx`(`portal_account_id`, `purpose`),
    INDEX `patient_portal_security_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `patient_portal_accounts_recovery_email_key` ON `patient_portal_accounts`(`recovery_email`);

-- AddForeignKey
ALTER TABLE `patient_portal_security_tokens` ADD CONSTRAINT `patient_portal_security_tokens_portal_account_id_fkey` FOREIGN KEY (`portal_account_id`) REFERENCES `patient_portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
