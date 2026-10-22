-- LMS phase B6: leave and transfer applications, and how much leave a class teacher may
-- approve alone. Diffed read-only against the live schema (no shadow database). Additive, plus
-- the default English wording of the transfer letter.

-- AlterTable
ALTER TABLE "Institute" ADD COLUMN     "leaveTeacherMaxDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeaveApplication" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "studentUserId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recommendation" TEXT,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "excusedMarks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferApplication" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "studentUserId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "destination" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "duesCleared" BOOLEAN NOT NULL DEFAULT false,
    "libraryCleared" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifyNote" TEXT,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "letterSerial" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveApplication_instituteId_status_idx" ON "LeaveApplication"("instituteId", "status");

-- CreateIndex
CREATE INDEX "LeaveApplication_studentUserId_idx" ON "LeaveApplication"("studentUserId");

-- CreateIndex
CREATE INDEX "LeaveApplication_sectionId_status_idx" ON "LeaveApplication"("sectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransferApplication_letterSerial_key" ON "TransferApplication"("letterSerial");

-- CreateIndex
CREATE INDEX "TransferApplication_instituteId_status_idx" ON "TransferApplication"("instituteId", "status");

-- CreateIndex
CREATE INDEX "TransferApplication_studentUserId_idx" ON "TransferApplication"("studentUserId");

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferApplication" ADD CONSTRAINT "TransferApplication_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferApplication" ADD CONSTRAINT "TransferApplication_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: the transfer letter's default English wording. Editable in the admin panel.
INSERT INTO "DocumentTemplate" ("instituteId", "type", "lang", "title", "body", "signatoryTitle", "updatedAt")
VALUES (1, 'TRANSFER_LETTER', 'en', 'Transfer Certificate',
  'This is to certify that {{name}}, Student ID {{studentId}}, was a student of {{institute}}, most recently in {{class}}. At the request of the guardian, the student is transferred to {{destination}} with effect from {{effectiveDate}}. All dues to the school have been cleared. We wish {{name}} every success.',
  'Head Master', CURRENT_TIMESTAMP);
