-- PB-1: generated with migrate dev --create-only on disposable MariaDB.
-- Reviewed: omit four pre-existing telephony FK naming differences; inline new billing FKs.

-- CreateTable
CREATE TABLE `clinic_billing_settings` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `gstin` VARCHAR(15) NULL,
    `legal_name` VARCHAR(200) NULL,
    `invoice_prefix` VARCHAR(4) NOT NULL DEFAULT 'INV',
    `staff_discount_limit_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `footer_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_billing_settings_clinic_id_key`(`clinic_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `clinic_billing_settings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `clinic_billing_settings_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_items` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NULL,
    `name` VARCHAR(120) NOT NULL,
    `category` ENUM('CONSULTATION', 'PROCEDURE', 'TEST', 'OTHER') NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `tax_rate_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `sac_code` VARCHAR(8) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_items_tenant_id_clinic_id_name_key`(`tenant_id`, `clinic_id`, `name`),
    PRIMARY KEY (`id`),
    CONSTRAINT `service_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `service_items_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `active_key` VARCHAR(30) NULL,
    `invoice_number` VARCHAR(16) NULL,
    `financial_year` VARCHAR(4) NULL,
    `document_type` ENUM('INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY') NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `discount_total` DECIMAL(10, 2) NOT NULL,
    `taxable_total` DECIMAL(10, 2) NOT NULL,
    `cgst_total` DECIMAL(10, 2) NOT NULL,
    `sgst_total` DECIMAL(10, 2) NOT NULL,
    `grand_total` DECIMAL(10, 2) NOT NULL,
    `amount_paid` DECIMAL(10, 2) NOT NULL,
    `balance_due` DECIMAL(10, 2) NOT NULL,
    `payment_status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `snapshot` JSON NULL,
    `issued_at` DATETIME(3) NULL,
    `issued_by_id` VARCHAR(191) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_id` VARCHAR(191) NULL,
    `cancel_reason` TEXT NULL,
    `replaces_invoice_id` VARCHAR(191) NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_active_key_key`(`active_key`),
    UNIQUE INDEX `invoices_replaces_invoice_id_key`(`replaces_invoice_id`),
    INDEX `invoices_clinic_id_status_issued_at_idx`(`clinic_id`, `status`, `issued_at`),
    INDEX `invoices_clinic_id_payment_status_idx`(`clinic_id`, `payment_status`),
    INDEX `invoices_patient_id_idx`(`patient_id`),
    INDEX `invoices_doctor_id_idx`(`doctor_id`),
    INDEX `invoices_registration_id_idx`(`registration_id`),
    UNIQUE INDEX `invoices_clinic_id_invoice_number_key`(`clinic_id`, `invoice_number`),
    PRIMARY KEY (`id`),
    CONSTRAINT `invoices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_issued_by_id_fkey` FOREIGN KEY (`issued_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_replaces_invoice_id_fkey` FOREIGN KEY (`replaces_invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_lines` (
    `id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `service_item_id` VARCHAR(191) NULL,
    `description` VARCHAR(200) NOT NULL,
    `category` ENUM('CONSULTATION', 'PROCEDURE', 'TEST', 'OTHER') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_price` DECIMAL(10, 2) NOT NULL,
    `discount_amount` DECIMAL(10, 2) NOT NULL,
    `tax_rate_percent` DECIMAL(5, 2) NOT NULL,
    `sac_code` VARCHAR(8) NULL,
    `taxable_amount` DECIMAL(10, 2) NOT NULL,
    `tax_amount` DECIMAL(10, 2) NOT NULL,
    `line_total` DECIMAL(10, 2) NOT NULL,

    UNIQUE INDEX `invoice_lines_invoice_id_position_key`(`invoice_id`, `position`),
    PRIMARY KEY (`id`),
    CONSTRAINT `invoice_lines_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `invoice_lines_service_item_id_fkey` FOREIGN KEY (`service_item_id`) REFERENCES `service_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_payments` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `mode` ENUM('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER') NOT NULL,
    `reference` VARCHAR(100) NULL,
    `received_at` DATETIME(3) NOT NULL,
    `recorded_by_id` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'VOIDED') NOT NULL DEFAULT 'ACTIVE',
    `voided_at` DATETIME(3) NULL,
    `voided_by_id` VARCHAR(191) NULL,
    `void_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `invoice_payments_clinic_id_received_at_idx`(`clinic_id`, `received_at`),
    INDEX `invoice_payments_invoice_id_idx`(`invoice_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `invoice_payments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoice_payments_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoice_payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoice_payments_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoice_payments_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_number_sequences` (
    `clinic_id` VARCHAR(191) NOT NULL,
    `financial_year` VARCHAR(4) NOT NULL,
    `last_number` INTEGER NOT NULL,

    PRIMARY KEY (`clinic_id`, `financial_year`),
    CONSTRAINT `invoice_number_sequences_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
