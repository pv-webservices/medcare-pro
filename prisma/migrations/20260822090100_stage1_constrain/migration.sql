-- MEDCARE PRO — Stage 1, migration 2 of 2: CONSTRAIN
--
-- Run ONLY after the backfill has completed and `npm run stage1:verify` passes.
-- Every statement below fails loudly if any row is still un-backfilled. That is
-- the intended safety behaviour: a failure here means the backfill was skipped
-- or left incomplete, never that data was lost.
--
-- Not run against production.

-- AlterTable — updated_at backfilled to created_at.
ALTER TABLE `tenants` MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL;
ALTER TABLE `users` MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL;
ALTER TABLE `roles` MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL;

-- AlterTable — created_at backfilled (roles from the owning tenant, user_roles
-- from the owning user). The DEFAULT is introduced here rather than in the
-- expand migration so that existing rows were never silently stamped with the
-- migration timestamp.
ALTER TABLE `roles` MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
ALTER TABLE `user_roles` MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex — deferred from the expand migration until the backfill had
-- generated a slug for every tenant and a key for every seeded role.
--
-- tenants.slug stays NULLABLE here on purpose: a UNIQUE index permits many
-- NULLs in MySQL, and requiring the column would change the type of
-- prisma.tenant.create() and force an edit to api/auth/signup, which Stage 1
-- must not touch. Stage 3 makes it NOT NULL when signup starts generating one.
-- roles(tenant_id, key) is safe alongside many NULL keys: MySQL treats NULLs as
-- distinct, so any number of custom roles coexist under one tenant.
CREATE UNIQUE INDEX `tenants_slug_key` ON `tenants`(`slug`);
CREATE UNIQUE INDEX `roles_tenant_id_key_key` ON `roles`(`tenant_id`, `key`);
