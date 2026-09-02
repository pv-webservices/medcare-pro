-- AlterTable: clinics.logo_url VARCHAR(191) -> LONGTEXT
--
-- The Prisma schema has carried @db.LongText on Clinic.logoUrl since the
-- model was committed, but the initial migration created the column as
-- VARCHAR(191).  Base64 data URIs from file uploads are truncated at 191
-- characters, which is why the clinic logo breaks after a page refresh.
--
-- This migration closes the documented drift noted in APPOINTMENT_NOTES.md.

ALTER TABLE `clinics` MODIFY `logo_url` LONGTEXT NULL;
