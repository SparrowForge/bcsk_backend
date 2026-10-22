-- LMS phase B4: grading schemes, exams, exam papers, per-section mark sheets and marks.
-- Written from an offline `prisma migrate diff` (schema to schema); no shadow database.
-- Additive, plus one seed: the Bangladesh GPA 5.0 scheme for the founding institute.

-- CreateTable
CREATE TABLE "GradingScheme" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GPA',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" SERIAL NOT NULL,
    "schemeId" INTEGER NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "gradePoint" DOUBLE PRECISION,
    "passing" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TERM',
    "gradingSchemeId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT,
    "calendarEventId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" SERIAL NOT NULL,
    "examId" INTEGER NOT NULL,
    "courseLevelId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "room" TEXT,
    "fullMarks" INTEGER NOT NULL,
    "passMarks" INTEGER NOT NULL,
    "examinerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkSheet" (
    "id" SERIAL NOT NULL,
    "paperId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "reopenedById" INTEGER,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" SERIAL NOT NULL,
    "paperId" INTEGER NOT NULL,
    "studentUserId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "obtained" DOUBLE PRECISION,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "enteredById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingScheme_instituteId_name_key" ON "GradingScheme"("instituteId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_schemeId_minPercent_key" ON "GradeBand"("schemeId", "minPercent");

-- CreateIndex
CREATE INDEX "Exam_termId_status_idx" ON "Exam"("termId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_instituteId_termId_name_key" ON "Exam"("instituteId", "termId", "name");

-- CreateIndex
CREATE INDEX "ExamPaper_courseLevelId_date_idx" ON "ExamPaper"("courseLevelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_examId_courseLevelId_subjectId_key" ON "ExamPaper"("examId", "courseLevelId", "subjectId");

-- CreateIndex
CREATE INDEX "MarkSheet_sectionId_idx" ON "MarkSheet"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MarkSheet_paperId_sectionId_key" ON "MarkSheet"("paperId", "sectionId");

-- CreateIndex
CREATE INDEX "Mark_sectionId_paperId_idx" ON "Mark"("sectionId", "paperId");

-- CreateIndex
CREATE INDEX "Mark_studentUserId_idx" ON "Mark"("studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_paperId_studentUserId_key" ON "Mark"("paperId", "studentUserId");

-- AddForeignKey
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "GradingScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_examinerId_fkey" FOREIGN KEY ("examinerId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: Bangladesh secondary-board GPA 5.0, the founding institute's default scheme. Each band
-- runs from its lower bound up to the next one; F is the only failing grade.
INSERT INTO "GradingScheme" ("instituteId", "name", "kind", "isDefault", "updatedAt")
VALUES (1, 'Bangladesh GPA 5.0', 'GPA', true, CURRENT_TIMESTAMP);

INSERT INTO "GradeBand" ("schemeId", "minPercent", "grade", "gradePoint", "passing", "remark")
SELECT s."id", b."minPercent", b."grade", b."gradePoint", b."passing", b."remark"
FROM "GradingScheme" s
CROSS JOIN (VALUES
    (80.0, 'A+', 5.0, true,  'Outstanding'),
    (70.0, 'A',  4.0, true,  'Excellent'),
    (60.0, 'A-', 3.5, true,  'Very good'),
    (50.0, 'B',  3.0, true,  'Good'),
    (40.0, 'C',  2.0, true,  'Satisfactory'),
    (33.0, 'D',  1.0, true,  'Pass'),
    (0.0,  'F',  0.0, false, 'Fail')
) AS b("minPercent", "grade", "gradePoint", "passing", "remark")
WHERE s."instituteId" = 1 AND s."name" = 'Bangladesh GPA 5.0';
