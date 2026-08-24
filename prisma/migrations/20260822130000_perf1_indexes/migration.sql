-- CreateIndex
CREATE INDEX "ApplicationForm_status_createdAt_idx" ON "ApplicationForm"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_classSessionId_createdAt_idx" ON "Assignment"("classSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Attendance_studentUserId_date_idx" ON "Attendance"("studentUserId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Certificate_studentUserId_idx" ON "Certificate"("studentUserId");

-- CreateIndex
CREATE INDEX "ClassSession_courseId_idx" ON "ClassSession"("courseId");

-- CreateIndex
CREATE INDEX "ClassSession_courseLevelId_idx" ON "ClassSession"("courseLevelId");

-- CreateIndex
CREATE INDEX "ClassSession_teacherId_idx" ON "ClassSession"("teacherId");

-- CreateIndex
CREATE INDEX "ClassSession_classLevel_semester_active_idx" ON "ClassSession"("classLevel", "semester", "active");

-- CreateIndex
CREATE INDEX "ClassSession_semester_active_idx" ON "ClassSession"("semester", "active");

-- CreateIndex
CREATE INDEX "ClassVideo_classSessionId_recordedAt_idx" ON "ClassVideo"("classSessionId", "recordedAt");

-- CreateIndex
CREATE INDEX "ContentPage_slug_status_idx" ON "ContentPage"("slug", "status");

-- CreateIndex
CREATE INDEX "CourseLevel_courseId_displayOrder_idx" ON "CourseLevel"("courseId", "displayOrder");

-- CreateIndex
CREATE INDEX "CurriculumEntry_classLevel_displayOrder_idx" ON "CurriculumEntry"("classLevel", "displayOrder");

-- CreateIndex
CREATE INDEX "Enrollment_classSessionId_idx" ON "Enrollment"("classSessionId");

-- CreateIndex
CREATE INDEX "Enrollment_studentUserId_semester_status_idx" ON "Enrollment"("studentUserId", "semester", "status");

-- CreateIndex
CREATE INDEX "EventNews_published_date_idx" ON "EventNews"("published", "date");

-- CreateIndex
CREATE INDEX "ExamResult_studentUserId_semester_idx" ON "ExamResult"("studentUserId", "semester");

-- CreateIndex
CREATE INDEX "GalleryItem_albumId_idx" ON "GalleryItem"("albumId");

-- CreateIndex
CREATE INDEX "GameScore_studentUserId_game_idx" ON "GameScore"("studentUserId", "game");

-- CreateIndex
CREATE INDEX "GoverningMember_kind_displayOrder_idx" ON "GoverningMember"("kind", "displayOrder");

-- CreateIndex
CREATE INDEX "HifzProgress_studentUserId_idx" ON "HifzProgress"("studentUserId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "Payment_applicationId_idx" ON "Payment"("applicationId");

-- CreateIndex
CREATE INDEX "Payment_payerUserId_idx" ON "Payment"("payerUserId");

-- CreateIndex
CREATE INDEX "Payment_verifiedById_idx" ON "Payment"("verifiedById");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressRecord_studentUserId_courseSlug_idx" ON "ProgressRecord"("studentUserId", "courseSlug");

-- CreateIndex
CREATE INDEX "Question_studentUserId_idx" ON "Question"("studentUserId");

-- CreateIndex
CREATE INDEX "Question_teacherUserId_answeredAt_idx" ON "Question"("teacherUserId", "answeredAt");

-- CreateIndex
CREATE INDEX "StudentCornerPost_published_createdAt_idx" ON "StudentCornerPost"("published", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_studentUserId_idx" ON "Submission"("studentUserId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherTask_teacherUserId_done_idx" ON "TeacherTask"("teacherUserId", "done");

