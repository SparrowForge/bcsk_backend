-- LMS phase B1: departments, terms, batches, sections, subjects, curriculum, section enrolment
-- and teacher assignment. Written from an offline `prisma migrate diff` (schema to schema); no
-- shadow database. Purely additive: existing rows are filled by `prisma/backfill-b1.ts`.

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "admissionDate" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "departmentId" INTEGER;

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "sectionId" INTEGER,
ADD COLUMN     "subjectId" INTEGER;

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "headUserId" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" SERIAL NOT NULL,
    "courseLevelId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "room" TEXT,
    "classTeacherId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "departmentId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'THEORY',
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumSubject" (
    "id" SERIAL NOT NULL,
    "courseLevelId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "fullMarks" INTEGER NOT NULL DEFAULT 100,
    "passMarks" INTEGER NOT NULL DEFAULT 33,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "CurriculumSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionEnrollment" (
    "id" SERIAL NOT NULL,
    "studentUserId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "batchId" INTEGER NOT NULL,
    "rollNo" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAssignment" (
    "id" SERIAL NOT NULL,
    "teacherProfileId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_instituteId_code_key" ON "Department"("instituteId", "code");

-- CreateIndex
CREATE INDEX "AcademicTerm_instituteId_isCurrent_idx" ON "AcademicTerm"("instituteId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_instituteId_code_key" ON "AcademicTerm"("instituteId", "code");

-- CreateIndex
CREATE INDEX "Batch_termId_idx" ON "Batch"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_courseLevelId_termId_key" ON "Batch"("courseLevelId", "termId");

-- CreateIndex
CREATE INDEX "Section_classTeacherId_idx" ON "Section"("classTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_batchId_name_key" ON "Section"("batchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_instituteId_code_key" ON "Subject"("instituteId", "code");

-- CreateIndex
CREATE INDEX "CurriculumSubject_subjectId_idx" ON "CurriculumSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumSubject_courseLevelId_subjectId_key" ON "CurriculumSubject"("courseLevelId", "subjectId");

-- CreateIndex
CREATE INDEX "SectionEnrollment_sectionId_status_idx" ON "SectionEnrollment"("sectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SectionEnrollment_studentUserId_batchId_key" ON "SectionEnrollment"("studentUserId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionEnrollment_sectionId_rollNo_key" ON "SectionEnrollment"("sectionId", "rollNo");

-- CreateIndex
CREATE INDEX "TeacherAssignment_sectionId_subjectId_idx" ON "TeacherAssignment"("sectionId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAssignment_teacherProfileId_sectionId_subjectId_key" ON "TeacherAssignment"("teacherProfileId", "sectionId", "subjectId");

-- CreateIndex
CREATE INDEX "ClassSession_sectionId_idx" ON "ClassSession"("sectionId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumSubject" ADD CONSTRAINT "CurriculumSubject_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumSubject" ADD CONSTRAINT "CurriculumSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEnrollment" ADD CONSTRAINT "SectionEnrollment_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEnrollment" ADD CONSTRAINT "SectionEnrollment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEnrollment" ADD CONSTRAINT "SectionEnrollment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
