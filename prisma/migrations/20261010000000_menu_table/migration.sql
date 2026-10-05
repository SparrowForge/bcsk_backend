-- A real Menu table for all three panels (admin, teacher, student): module, name, link, order and
-- the switches each menu offers. Per-user permissions now point at a Menu row instead of
-- carrying a bare text key.

-- CreateTable
CREATE TABLE "Menu" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "note" TEXT,
    "actions" TEXT NOT NULL DEFAULT 'access',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Menu_key_key" ON "Menu"("key");
CREATE INDEX "Menu_panel_displayOrder_idx" ON "Menu"("panel", "displayOrder");

-- Seed every current menu of the admin, teacher and student panels, with its module name.
INSERT INTO "Menu" ("key", "panel", "module", "label", "href", "note", "actions", "displayOrder", "active", "createdAt", "updatedAt") VALUES
  ('admissions', 'ADMIN', 'Admissions & Fees', 'Admissions', '/admin/admissions', 'Update = approve / reject / request corrections', 'access,update', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payments', 'ADMIN', 'Admissions & Fees', 'Payments', '/admin/payments', 'Access includes CSV export; Update = verify; Delete = refund', 'access,update,delete', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fees', 'ADMIN', 'Admissions & Fees', 'Fee Configuration', '/admin/fees', NULL, 'access', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('coupons', 'ADMIN', 'Admissions & Fees', 'Coupons', '/admin/coupons', NULL, 'access', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('leads', 'ADMIN', 'CRM', 'CRM Leads', '/admin/leads', 'Update = create, edit, assign, convert and delete leads and sources', 'access,update', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tickets', 'ADMIN', 'CRM', 'Support Tickets', '/admin/tickets', NULL, 'access', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cms', 'ADMIN', 'Website Content', 'CMS Pages', '/admin/cms', NULL, 'access', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news', 'ADMIN', 'Website Content', 'News & Events', '/admin/news', NULL, 'access', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gallery', 'ADMIN', 'Website Content', 'Media Gallery', '/admin/gallery', NULL, 'access', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slider', 'ADMIN', 'Website Content', 'Homepage Slider', '/admin/hero-slider', NULL, 'access', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('corner', 'ADMIN', 'Website Content', 'Student Corner', '/admin/student-corner', NULL, 'access', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('governing', 'ADMIN', 'Website Content', 'Governing Body', '/admin/governing', NULL, 'access', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('courses', 'ADMIN', 'Academics', 'Courses & Levels', '/admin/courses', NULL, 'access', 120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('scheduling', 'ADMIN', 'Academics', 'Scheduling', '/admin/scheduling', NULL, 'access', 130, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('reports', 'ADMIN', 'Academics', 'Reports', '/admin/reports', 'Exam results and student documents', 'access', 140, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('users', 'ADMIN', 'Administration', 'Users', '/admin/users', NULL, 'access', 150, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('settings', 'ADMIN', 'Administration', 'Settings', '/admin/settings', NULL, 'access', 160, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('audit', 'ADMIN', 'Administration', 'Audit Log', '/admin/audit', NULL, 'access', 170, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('office.classes', 'TEACHER', 'Teaching', 'My Classes', '/office/classes', 'Insert = attendance, assignments, videos, grading; Update = go live / end class', 'access,insert,update', 180, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('office.questions', 'TEACHER', 'Teaching', 'Questions', '/office/questions', 'Insert = answer a question', 'access,insert', 190, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('office.tasks', 'TEACHER', 'Teaching', 'Task List', '/office/tasks', 'Update = tick a task done', 'access,update', 200, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('office.guardians', 'TEACHER', 'Students & Guardians', 'Guardians', '/office/guardians', NULL, 'access', 210, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.assignments', 'STUDENT', 'Learning', 'Assignments', '/classroom/assignments', 'Insert = submit work', 'access,insert', 220, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.videos', 'STUDENT', 'Learning', 'Class Videos', '/classroom/videos', NULL, 'access', 230, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.routine', 'STUDENT', 'Learning', 'Routine', '/classroom/routine', NULL, 'access', 240, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.syllabus', 'STUDENT', 'Learning', 'Syllabus', '/classroom/syllabus', NULL, 'access', 250, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.results', 'STUDENT', 'Progress', 'Results', '/classroom/results', NULL, 'access', 260, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.attendance', 'STUDENT', 'Progress', 'Attendance', '/classroom/attendance', NULL, 'access', 270, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.documents', 'STUDENT', 'Account', 'Documents', '/classroom/documents', NULL, 'access', 280, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.payments', 'STUDENT', 'Account', 'Payments', '/classroom/payments', NULL, 'access', 290, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.re-admission', 'STUDENT', 'Account', 'Re-Admission', '/classroom/re-admission', 'Insert = submit the re-admission payment', 'access,insert', 300, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('classroom.ask-teacher', 'STUDENT', 'Support', 'Ask Teacher', '/classroom/ask-teacher', 'Insert = send a question', 'access,insert', 310, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
;

-- Move existing per-user permissions from the text key to the Menu row.
ALTER TABLE "UserMenuPermission" ADD COLUMN "menuId" INTEGER;
UPDATE "UserMenuPermission" p SET "menuId" = m."id" FROM "Menu" m WHERE m."key" = p."menuKey";
-- A permission for a menu that no longer exists cannot be kept (the first catalog had grouped
-- keys such as 'content'); that user falls back to their role until a super admin re-saves.
DELETE FROM "UserMenuPermission" WHERE "menuId" IS NULL;
ALTER TABLE "UserMenuPermission" ALTER COLUMN "menuId" SET NOT NULL;

DROP INDEX "UserMenuPermission_userId_menuKey_key";
ALTER TABLE "UserMenuPermission" DROP COLUMN "menuKey";

-- CreateIndex
CREATE UNIQUE INDEX "UserMenuPermission_userId_menuId_key" ON "UserMenuPermission"("userId", "menuId");
CREATE INDEX "UserMenuPermission_menuId_idx" ON "UserMenuPermission"("menuId");

-- AddForeignKey
ALTER TABLE "UserMenuPermission" ADD CONSTRAINT "UserMenuPermission_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
