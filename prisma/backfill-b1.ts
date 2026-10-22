/**
 * LMS B1 backfill: fill the academic-structure tables from today's class sessions and
 * enrolments, so existing students and teachers appear in sections without anyone re-entering
 * them. Run after migration 20261022010000_b1_academic_structure.
 *
 *   npm run db:backfill-b1               # dry run: prints the plan and the counts, writes nothing
 *   npm run db:backfill-b1 -- --apply    # writes it
 *
 * Idempotent: every write is an upsert or skips rows already there, so it is safe to re-run.
 * It never deletes and never changes a section placement the office already made. The mapping
 * rules live in src/modules/structure/backfill-plan.ts, where they are unit-tested.
 *
 * Check the printed "placed vs enrolled" line before applying: the two should match for the
 * current term; any gap is listed under the unplaced sessions or the conflicts above it.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_INSTITUTE_ID, SEMESTER_CURRENT } from "../src/common/constants";
import { batchKeyString, planBackfill, sectionKeyString, subjectCode } from "../src/modules/structure/backfill-plan";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const INSTITUTE = DEFAULT_INSTITUTE_ID;

async function main() {
  const [levels, courses, sessions, enrollments] = await Promise.all([
    db.courseLevel.findMany({ select: { id: true, courseId: true, code: true, name: true, course: { select: { name: true } } } }),
    db.course.findMany({ where: { instituteId: INSTITUTE }, select: { id: true, slug: true, name: true, type: true } }),
    db.classSession.findMany({
      where: { course: { instituteId: INSTITUTE } },
      select: { id: true, title: true, courseId: true, courseLevelId: true, classLevel: true, semester: true, teacherId: true, active: true },
    }),
    db.enrollment.findMany({
      where: { student: { instituteId: INSTITUTE } },
      orderBy: { id: "asc" },
      select: { studentUserId: true, classSessionId: true, semester: true, status: true },
    }),
  ]);
  const students = await db.user.findMany({
    where: { id: { in: [...new Set(enrollments.map((e) => e.studentUserId))] } },
    select: { id: true, name: true },
  });

  const plan = planBackfill({
    levels,
    regularCourseIds: courses.filter((c) => c.slug === "regular-course").map((c) => c.id),
    courses,
    sessions,
    enrollments,
    studentNames: Object.fromEntries(students.map((s) => [s.id, s.name])),
    currentTerm: SEMESTER_CURRENT,
  });

  const levelName = new Map(levels.map((l) => [l.id, `${l.course.name} - ${l.name}`]));
  console.log(`Terms:        ${plan.terms.map((t) => t.code + (t.isCurrent ? " (current)" : "")).join(", ")}`);
  console.log(`Subjects:     ${plan.subjects.map((s) => s.code).join(", ")}`);
  console.log(`Curriculum:   ${plan.curriculum.length} class-subject pairs`);
  console.log(`Batches:      ${plan.batches.length}`);
  console.log(`Sections:     ${plan.sections.length}`);
  for (const k of plan.sections) console.log(`  ${k.term}  ${levelName.get(k.levelId) ?? k.levelId}  section ${k.section}`);
  console.log(`Sessions:     ${plan.sessionLinks.length} linked, ${plan.unplacedSessions.length} left unplaced`);
  for (const u of plan.unplacedSessions) console.log(`  #${u.sessionId} "${u.title}": ${u.reason}`);
  console.log(`Assignments:  ${plan.assignments.length}`);
  console.log(`Placements:   ${plan.placements.length}`);
  for (const c of plan.placementConflicts) console.log(`  student ${c.studentUserId}: kept ${c.kept}, not ${c.dropped}`);
  for (const [term, enrolled] of Object.entries(plan.enrolledStudentsByTerm)) {
    const placed = new Set(plan.placements.filter((p) => p.key.term === term).map((p) => p.studentUserId)).size;
    console.log(`  ${term}: ${placed} students placed vs ${enrolled} with an active enrolment`);
  }

  if (!APPLY) {
    console.log("\nDry run - nothing written. Re-run with --apply to write.");
    return;
  }

  // 1. terms. The current one is marked only if the institute has none yet.
  const hasCurrent = (await db.academicTerm.count({ where: { instituteId: INSTITUTE, isCurrent: true } })) > 0;
  for (const t of plan.terms) {
    await db.academicTerm.upsert({
      where: { instituteId_code: { instituteId: INSTITUTE, code: t.code } },
      update: {},
      create: { instituteId: INSTITUTE, code: t.code, name: `Semester ${t.code}`, isCurrent: t.isCurrent && !hasCurrent },
    });
  }
  const termId = new Map((await db.academicTerm.findMany({ where: { instituteId: INSTITUTE } })).map((t) => [t.code, t.id]));

  // 2. subjects, one per course taught.
  await db.subject.createMany({
    data: plan.subjects.map((s) => ({ instituteId: INSTITUTE, code: s.code, name: s.name })),
    skipDuplicates: true,
  });
  const subjectByCode = new Map((await db.subject.findMany({ where: { instituteId: INSTITUTE } })).map((s) => [s.code, s.id]));
  const courseSlug = new Map(courses.map((c) => [c.id, c.slug]));
  const subjectId = (courseId: number) => subjectByCode.get(subjectCode(courseSlug.get(courseId)!))!;

  // 3. curriculum.
  await db.curriculumSubject.createMany({
    data: plan.curriculum.map((c) => ({ courseLevelId: c.levelId, subjectId: subjectId(c.courseId) })),
    skipDuplicates: true,
  });

  // 4. batches, 5. sections.
  await db.batch.createMany({
    data: plan.batches.map((b) => ({
      courseLevelId: b.levelId, termId: termId.get(b.term)!, name: `${levelName.get(b.levelId) ?? "Class"}, ${b.term}`,
    })),
    skipDuplicates: true,
  });
  const batchRows = await db.batch.findMany({ where: { term: { instituteId: INSTITUTE } }, include: { term: true } });
  const batchId = new Map(batchRows.map((b) => [batchKeyString({ levelId: b.courseLevelId, term: b.term.code }), b.id]));
  await db.section.createMany({
    data: plan.sections.map((k) => ({ batchId: batchId.get(batchKeyString(k))!, name: k.section })),
    skipDuplicates: true,
  });
  const sectionRows = await db.section.findMany({ where: { batchId: { in: [...batchId.values()] } }, include: { batch: { include: { term: true } } } });
  const sectionId = new Map(sectionRows.map((s) => [
    sectionKeyString({ levelId: s.batch.courseLevelId, term: s.batch.term.code, section: s.name }), s.id,
  ]));

  // 6. sessions gain their section and subject - only those not linked yet.
  await db.$transaction(
    plan.sessionLinks.map((l) => db.classSession.updateMany({
      where: { id: l.sessionId, sectionId: null },
      data: { sectionId: sectionId.get(sectionKeyString(l.key))!, subjectId: subjectId(l.courseId) },
    })),
  );

  // 7. teacher assignments.
  await db.teacherAssignment.createMany({
    data: plan.assignments.map((a) => ({
      teacherProfileId: a.teacherProfileId, sectionId: sectionId.get(sectionKeyString(a.key))!, subjectId: subjectId(a.courseId),
    })),
    skipDuplicates: true,
  });

  // 8. placements. A student already placed in a batch keeps that place; new ones continue the
  // section's numbering so a re-run never collides with a roll number already handed out.
  const existing = await db.sectionEnrollment.findMany({ select: { studentUserId: true, batchId: true, sectionId: true, rollNo: true } });
  const taken = new Set(existing.map((e) => `${e.studentUserId}|${e.batchId}`));
  const maxRoll = new Map<number, number>();
  for (const e of existing) maxRoll.set(e.sectionId, Math.max(maxRoll.get(e.sectionId) ?? 0, e.rollNo ?? 0));
  const fresh = plan.placements
    .map((p) => ({ ...p, sectionId: sectionId.get(sectionKeyString(p.key))!, batchId: batchId.get(batchKeyString(p.key))! }))
    .filter((p) => !taken.has(`${p.studentUserId}|${p.batchId}`));
  const nextRoll = new Map<number, number>();
  await db.sectionEnrollment.createMany({
    data: fresh.map((p) => {
      const n = (nextRoll.get(p.sectionId) ?? maxRoll.get(p.sectionId) ?? 0) + 1;
      nextRoll.set(p.sectionId, n);
      return { studentUserId: p.studentUserId, sectionId: p.sectionId, batchId: p.batchId, rollNo: n };
    }),
    skipDuplicates: true,
  });

  await db.auditLog.create({
    data: { action: "LMS_BACKFILL_B1", entity: "Institute", entityId: String(INSTITUTE), detail: `${fresh.length} placements, ${plan.sections.length} sections` },
  });
  console.log(`\nApplied. ${fresh.length} new placements.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
