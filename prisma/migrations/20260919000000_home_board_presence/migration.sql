-- Homepage office board (LP-2): a teacher's own desk presence.
-- "In class" is deliberately NOT a stored status — it is derived from owning a live
-- ClassSession, so the office board cannot disagree with the classroom board.
ALTER TABLE "TeacherProfile" ADD COLUMN "deskName" TEXT;
ALTER TABLE "TeacherProfile" ADD COLUMN "deskStatus" TEXT NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "TeacherProfile" ADD COLUMN "returnAt" TIMESTAMP(3);

-- Homepage classroom board (LP-3): how long the current class has been running.
ALTER TABLE "ClassSession" ADD COLUMN "liveSince" TIMESTAMP(3);

-- Backfill: any class already live when this ships has been live since now, not since epoch.
UPDATE "ClassSession" SET "liveSince" = CURRENT_TIMESTAMP WHERE "isLive" = true;
