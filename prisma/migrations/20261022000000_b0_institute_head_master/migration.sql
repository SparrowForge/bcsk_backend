-- LMS phase B0: institutes, institute ownership of users and courses, richer audit rows.
-- Written from an offline `prisma migrate diff` (schema to schema); no shadow database.
-- Reordered so the institute row exists before the foreign keys that point at it.

-- CreateTable
CREATE TABLE "Institute" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT,
    "nameKo" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "headMasterName" TEXT,
    "signatureUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institute_code_key" ON "Institute"("code");

-- The founding institute. Every existing user and course belongs to it (the column defaults below).
INSERT INTO "Institute" ("id", "code", "name", "nameBn", "nameKo", "address", "phone", "email", "updatedAt")
VALUES (
    1, 'BCSK', 'Bangladesh Community School', 'বাংলাদেশ কমিউনিটি স্কুল', '방글라데시 커뮤니티 스쿨',
    '794-29 Wangsan-ri, Mohyeon-eup, Cheoin-gu, Yongin-si, Gyeonggi-do, South Korea',
    '+82 10-8948-3447', 'bcskr22@gmail.com', CURRENT_TIMESTAMP
);
SELECT setval(pg_get_serial_sequence('"Institute"', 'id'), (SELECT MAX("id") FROM "Institute"));

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "instituteId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "instituteId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "diff" JSONB,
ADD COLUMN     "ip" TEXT;

-- CreateIndex
CREATE INDEX "User_instituteId_role_idx" ON "User"("instituteId", "role");

-- CreateIndex
CREATE INDEX "Course_instituteId_idx" ON "Course"("instituteId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
