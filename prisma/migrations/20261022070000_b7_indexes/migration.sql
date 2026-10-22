-- LMS phase B7: indexes for the queries B2-B7 added (routine clashes, exam paper clashes,
-- institute-wide attendance). Diffed read-only against the live schema (no shadow database).

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "ClassSession_semester_dayOfWeek_active_idx" ON "ClassSession"("semester", "dayOfWeek", "active");

-- CreateIndex
CREATE INDEX "ExamPaper_date_idx" ON "ExamPaper"("date");

