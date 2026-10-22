-- LMS phase B3: course materials; who marked attendance and a remark; assignment max marks and
-- author; numeric marks on submissions. Diffed read-only against the live schema (no shadow
-- database). Purely additive: new columns are nullable or defaulted.

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "maxMarks" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "markedById" INTEGER,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "marks" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CourseMaterial" (
    "id" SERIAL NOT NULL,
    "courseLevelId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseMaterial_courseLevelId_subjectId_idx" ON "CourseMaterial"("courseLevelId", "subjectId");

-- CreateIndex
CREATE INDEX "CourseMaterial_sectionId_idx" ON "CourseMaterial"("sectionId");

-- CreateIndex
CREATE INDEX "Attendance_classSessionId_date_idx" ON "Attendance"("classSessionId", "date");

-- AddForeignKey
ALTER TABLE "CourseMaterial" ADD CONSTRAINT "CourseMaterial_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMaterial" ADD CONSTRAINT "CourseMaterial_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMaterial" ADD CONSTRAINT "CourseMaterial_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

