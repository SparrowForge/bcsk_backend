-- AlterTable
ALTER TABLE "CourseLevel" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "FeeConfig" ADD COLUMN     "courseId" INTEGER,
ADD COLUMN     "courseLevelId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "CourseLevel_courseId_code_key" ON "CourseLevel"("courseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FeeConfig_courseLevelId_key" ON "FeeConfig"("courseLevelId");

-- CreateIndex
CREATE INDEX "FeeConfig_courseId_idx" ON "FeeConfig"("courseId");

-- AddForeignKey
ALTER TABLE "FeeConfig" ADD CONSTRAINT "FeeConfig_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeConfig" ADD CONSTRAINT "FeeConfig_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- DataMigration 1: the Regular Course and its six classes become real CourseLevel rows.
-- Until now Pre-Primary and Class 1-5 existed only as text ("CLASS_1") on other tables.
INSERT INTO "Course" ("slug", "name", "type", "category", "description", "active", "displayOrder")
SELECT 'regular-course', 'Regular Course', 'REGULAR', 'class',
       'Pre-Primary to Class 5 - the full NCTB curriculum.', true, 0
WHERE NOT EXISTS (SELECT 1 FROM "Course" WHERE "slug" = 'regular-course');

INSERT INTO "CourseLevel" ("courseId", "name", "code", "displayOrder")
SELECT c."id", v."name", v."code", v."ord"
FROM "Course" c
CROSS JOIN (VALUES
  ('Pre-Primary', 'PRE_PRIMARY', 0),
  ('Class 1', 'CLASS_1', 1),
  ('Class 2', 'CLASS_2', 2),
  ('Class 3', 'CLASS_3', 3),
  ('Class 4', 'CLASS_4', 4),
  ('Class 5', 'CLASS_5', 5)
) AS v("name", "code", "ord")
WHERE c."slug" = 'regular-course'
ON CONFLICT ("courseId", "code") DO NOTHING;

-- DataMigration 2: tie each existing fee row to what it prices.
-- Regular class fees: key pre_primary / class_1.. matches the level code.
UPDATE "FeeConfig" f
SET "courseId" = l."courseId", "courseLevelId" = l."id"
FROM "CourseLevel" l
JOIN "Course" c ON c."id" = l."courseId" AND c."slug" = 'regular-course'
WHERE f."kind" = 'REGULAR_CLASS' AND l."code" = UPPER(f."key") AND f."courseLevelId" IS NULL;

-- Special course fees: the course-wide default row, linked by slug.
UPDATE "FeeConfig" f
SET "courseId" = c."id"
FROM "Course" c
WHERE f."kind" = 'SPECIAL_COURSE' AND f."courseId" IS NULL
  AND c."slug" = REPLACE(f."key", '_', '-');

-- DataMigration 3: one fee row per level of every special course that has levels, starting from
-- the course's price. A level's own row is what gets charged, so each can now be priced alone.
INSERT INTO "FeeConfig" ("key", "label", "kind", "courseId", "courseLevelId", "admissionFee", "semesterFee",
                         "bcskPrice", "nonBcskPrice", "bookFee", "displayOrder", "active")
SELECT f."key" || '_l' || l."id",
       c."name" || ' - ' || l."name",
       'SPECIAL_LEVEL', c."id", l."id",
       f."admissionFee", f."semesterFee", f."bcskPrice", f."nonBcskPrice", f."bookFee",
       f."displayOrder" * 100 + l."displayOrder", f."active"
FROM "FeeConfig" f
JOIN "Course" c ON c."id" = f."courseId"
JOIN "CourseLevel" l ON l."courseId" = c."id"
WHERE f."kind" = 'SPECIAL_COURSE'
ON CONFLICT DO NOTHING;
