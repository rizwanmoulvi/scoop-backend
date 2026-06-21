/*
  Warnings:

  - The values [INTERNAL] on the enum `Platform` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Platform_new" AS ENUM ('X', 'REDDIT');
ALTER TABLE "User" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TABLE "Order" ALTER COLUMN "sourcePlatform" TYPE "Platform_new" USING ("sourcePlatform"::text::"Platform_new");
ALTER TYPE "Platform" RENAME TO "Platform_old";
ALTER TYPE "Platform_new" RENAME TO "Platform";
DROP TYPE "public"."Platform_old";
COMMIT;
