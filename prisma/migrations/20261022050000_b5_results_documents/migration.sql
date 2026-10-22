-- LMS phase B5: section results (process, approve, publish), result summaries and lines,
-- editable document templates, and a rank-ties setting per institute. ExamResult.marks widens
-- from integer to double (halves are allowed) and gains the exam it was published from.
-- Diffed read-only against the live schema (no shadow database).

-- AlterTable
ALTER TABLE "ExamResult" ADD COLUMN     "examId" INTEGER,
ALTER COLUMN "marks" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Institute" ADD COLUMN     "rankTies" TEXT NOT NULL DEFAULT 'SHARED';

-- CreateTable
CREATE TABLE "SectionResult" (
    "id" SERIAL NOT NULL,
    "examId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedById" INTEGER,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "publishedById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSummary" (
    "id" SERIAL NOT NULL,
    "examId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "studentUserId" INTEGER NOT NULL,
    "rollNo" INTEGER,
    "totalObtained" DOUBLE PRECISION NOT NULL,
    "totalFull" INTEGER NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "gpa" DOUBLE PRECISION,
    "grade" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "failedSubjects" INTEGER NOT NULL,
    "sectionPosition" INTEGER,
    "classPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultLine" (
    "id" SERIAL NOT NULL,
    "summaryId" INTEGER NOT NULL,
    "paperId" INTEGER NOT NULL,
    "subjectName" TEXT NOT NULL,
    "fullMarks" INTEGER NOT NULL,
    "passMarks" INTEGER NOT NULL,
    "obtained" DOUBLE PRECISION,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "percent" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "gradePoint" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ResultLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SectionResult_examId_sectionId_key" ON "SectionResult"("examId", "sectionId");

-- CreateIndex
CREATE INDEX "ResultSummary_examId_sectionId_idx" ON "ResultSummary"("examId", "sectionId");

-- CreateIndex
CREATE INDEX "ResultSummary_studentUserId_idx" ON "ResultSummary"("studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSummary_examId_studentUserId_key" ON "ResultSummary"("examId", "studentUserId");

-- CreateIndex
CREATE INDEX "ResultLine_summaryId_idx" ON "ResultLine"("summaryId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_instituteId_type_lang_key" ON "DocumentTemplate"("instituteId", "type", "lang");

-- CreateIndex
CREATE INDEX "ExamResult_examId_idx" ON "ExamResult"("examId");

-- AddForeignKey
ALTER TABLE "SectionResult" ADD CONSTRAINT "SectionResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionResult" ADD CONSTRAINT "SectionResult_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSummary" ADD CONSTRAINT "ResultSummary_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSummary" ADD CONSTRAINT "ResultSummary_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultLine" ADD CONSTRAINT "ResultLine_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "ResultSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed: default English wording for the two certificates the Head Master issues. Editable in
-- the admin panel; placeholders are filled when the certificate is printed.
INSERT INTO "DocumentTemplate" ("instituteId", "type", "lang", "title", "body", "signatoryTitle", "updatedAt")
VALUES
  (1, 'COMPLETION', 'en', 'Certificate of Completion',
   'This is to certify that {{name}}, Student ID {{studentId}}, has successfully completed {{class}} at {{institute}} in the {{term}} term{{resultLine}}.',
   'Head Master', CURRENT_TIMESTAMP),
  (1, 'CHARACTER', 'en', 'Character Certificate',
   'This is to certify that {{name}}, Student ID {{studentId}}, has been a student of {{institute}}, most recently in {{class}}. To the best of our knowledge, {{name}} bears a good moral character and has not been involved in any activity against the discipline of the school. We wish {{name}} every success.',
   'Head Master', CURRENT_TIMESTAMP);
