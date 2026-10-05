-- AlterTable
ALTER TABLE "ApplicationForm" ADD COLUMN     "learningMode" TEXT,
ADD COLUMN     "semester" TEXT,
ADD COLUMN     "studentId" TEXT;

-- CreateIndex
CREATE INDEX "ApplicationForm_type_createdAt_idx" ON "ApplicationForm"("type", "createdAt");
