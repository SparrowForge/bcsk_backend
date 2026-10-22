-- LMS phase B2: academic calendar, online class meetings and their join log, a room on routine
-- slots. Written from an offline `prisma migrate diff` (schema to schema); no shadow database.
-- Purely additive.

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "room" TEXT;

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" SERIAL NOT NULL,
    "instituteId" INTEGER NOT NULL,
    "termId" INTEGER,
    "courseLevelId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineClass" (
    "id" SERIAL NOT NULL,
    "classSessionId" INTEGER NOT NULL,
    "topic" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "joinUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "recordingUrl" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineClassJoin" (
    "id" SERIAL NOT NULL,
    "onlineClassId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlineClassJoin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_instituteId_startDate_idx" ON "CalendarEvent"("instituteId", "startDate");

-- CreateIndex
CREATE INDEX "OnlineClass_classSessionId_startsAt_idx" ON "OnlineClass"("classSessionId", "startsAt");

-- CreateIndex
CREATE INDEX "OnlineClass_status_startsAt_idx" ON "OnlineClass"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineClassJoin_onlineClassId_userId_key" ON "OnlineClassJoin"("onlineClassId", "userId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineClass" ADD CONSTRAINT "OnlineClass_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineClassJoin" ADD CONSTRAINT "OnlineClassJoin_onlineClassId_fkey" FOREIGN KEY ("onlineClassId") REFERENCES "OnlineClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineClassJoin" ADD CONSTRAINT "OnlineClassJoin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

