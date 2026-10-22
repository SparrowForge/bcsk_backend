/**
 * LMS B1 backfill, as a pure function: from today's courses, levels, class sessions and
 * enrolments, work out the terms, subjects, curriculum, batches, sections, teacher assignments
 * and section placements the new tables should hold. `prisma/backfill-b1.ts` reads the rows,
 * calls this, prints the plan and (with --apply) writes it. Kept free of the database so the
 * mapping rules are unit-tested.
 *
 * The rules, from how the data is shaped today:
 *  - A special-course session (Abacus, IELTS) names its class directly: `courseLevelId`.
 *  - A regular session names its class as text, `classLevel` "CLASS_3", sometimes with a
 *    section suffix "PRE_PRIMARY_B". The class is the Regular Course level with that code; the
 *    suffix, when there is one, is the section name, otherwise the section is "A".
 *  - The subject is the session's course: Bangla for "Class 3 - Bangla", Abacus for Abacus.
 *  - A student enrolled in sessions of two sections of one batch keeps the first and the other
 *    is reported, because a student holds one section per batch.
 */

export type PlanInput = {
  levels: { id: number; courseId: number; code: string | null; name: string }[];
  /** Courses whose levels are the regular classes (Pre-Primary..Class 5). */
  regularCourseIds: number[];
  courses: { id: number; slug: string; name: string }[];
  sessions: { id: number; title: string; courseId: number; courseLevelId: number | null; classLevel: string | null; semester: string; teacherId: number | null; active: boolean }[];
  enrollments: { studentUserId: number; classSessionId: number; semester: string; status: string }[];
  studentNames: Record<number, string>;
  currentTerm: string;
};

export type SectionKey = { levelId: number; term: string; section: string };
export const sectionKeyString = (k: SectionKey) => `${k.levelId}|${k.term}|${k.section}`;
export const batchKeyString = (k: { levelId: number; term: string }) => `${k.levelId}|${k.term}`;

/** A subject code from a course slug: "ielts-for-kids" -> "IELTS-FOR-KIDS", at most 20 characters. */
export const subjectCode = (slug: string) => slug.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 20);

export type BackfillPlan = {
  terms: { code: string; isCurrent: boolean }[];
  subjects: { courseId: number; code: string; name: string }[];
  curriculum: { levelId: number; courseId: number }[];
  batches: { levelId: number; term: string }[];
  sections: SectionKey[];
  sessionLinks: { sessionId: number; key: SectionKey; courseId: number }[];
  assignments: { teacherProfileId: number; key: SectionKey; courseId: number }[];
  placements: { studentUserId: number; key: SectionKey; rollNo: number }[];
  unplacedSessions: { sessionId: number; title: string; reason: string }[];
  placementConflicts: { studentUserId: number; kept: string; dropped: string }[];
  /** Students with at least one ACTIVE enrolment, per term - what placement should match. */
  enrolledStudentsByTerm: Record<string, number>;
};

export function planBackfill(input: PlanInput): BackfillPlan {
  const regularLevels = input.levels
    .filter((l) => l.code && input.regularCourseIds.includes(l.courseId))
    .sort((a, b) => (b.code!.length - a.code!.length)); // longest code first: an exact prefix wins
  const levelIds = new Set(input.levels.map((l) => l.id));
  const courseById = new Map(input.courses.map((c) => [c.id, c]));

  const keyForSession = (s: PlanInput["sessions"][number]): SectionKey | string => {
    if (s.courseLevelId != null) {
      if (!levelIds.has(s.courseLevelId)) return "its class no longer exists";
      return { levelId: s.courseLevelId, term: s.semester, section: "A" };
    }
    if (!s.classLevel) return "it names no class";
    const level = regularLevels.find((l) => s.classLevel === l.code || s.classLevel!.startsWith(`${l.code}_`));
    if (!level) return `no regular class has the code ${s.classLevel}`;
    const suffix = s.classLevel.slice(level.code!.length + 1);
    return { levelId: level.id, term: s.semester, section: suffix ? suffix.toUpperCase() : "A" };
  };

  const sections = new Map<string, SectionKey>();
  const sessionLinks: BackfillPlan["sessionLinks"] = [];
  const unplacedSessions: BackfillPlan["unplacedSessions"] = [];
  const sessionKey = new Map<number, SectionKey>();
  for (const s of input.sessions) {
    const key = keyForSession(s);
    if (typeof key === "string") {
      unplacedSessions.push({ sessionId: s.id, title: s.title, reason: key });
      continue;
    }
    sections.set(sectionKeyString(key), key);
    sessionKey.set(s.id, key);
    sessionLinks.push({ sessionId: s.id, key, courseId: s.courseId });
  }

  const usedCourses = new Set(sessionLinks.map((l) => l.courseId));
  const subjects = [...usedCourses]
    .map((id) => courseById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ courseId: c.id, code: subjectCode(c.slug), name: c.name }));

  const curriculum = new Map<string, { levelId: number; courseId: number }>();
  for (const l of sessionLinks) curriculum.set(`${l.key.levelId}|${l.courseId}`, { levelId: l.key.levelId, courseId: l.courseId });

  const assignments = new Map<string, BackfillPlan["assignments"][number]>();
  for (const s of input.sessions) {
    const key = sessionKey.get(s.id);
    if (!key || s.teacherId == null) continue;
    assignments.set(`${s.teacherId}|${sectionKeyString(key)}|${s.courseId}`, { teacherProfileId: s.teacherId, key, courseId: s.courseId });
  }

  // Placements: one section per student per batch, first enrolment wins.
  const placedInBatch = new Map<string, SectionKey>(); // `${student}|${batch}` -> section
  const placementConflicts: BackfillPlan["placementConflicts"] = [];
  const enrolledByTerm = new Map<string, Set<number>>();
  const active = input.enrollments.filter((e) => e.status === "ACTIVE");
  for (const e of active) {
    if (!enrolledByTerm.has(e.semester)) enrolledByTerm.set(e.semester, new Set());
    enrolledByTerm.get(e.semester)!.add(e.studentUserId);
    const key = sessionKey.get(e.classSessionId);
    if (!key) continue;
    const slot = `${e.studentUserId}|${batchKeyString(key)}`;
    const held = placedInBatch.get(slot);
    if (!held) placedInBatch.set(slot, key);
    else if (held.section !== key.section) {
      placementConflicts.push({ studentUserId: e.studentUserId, kept: sectionKeyString(held), dropped: sectionKeyString(key) });
    }
  }

  // Roll numbers 1..n per section, by student name.
  const bySection = new Map<string, number[]>();
  for (const [slot, key] of placedInBatch) {
    const student = Number(slot.split("|")[0]);
    const k = sectionKeyString(key);
    if (!bySection.has(k)) bySection.set(k, []);
    bySection.get(k)!.push(student);
  }
  const placements: BackfillPlan["placements"] = [];
  for (const [k, students] of bySection) {
    const key = sections.get(k)!;
    students
      .sort((a, b) => (input.studentNames[a] ?? "").localeCompare(input.studentNames[b] ?? "") || a - b)
      .forEach((studentUserId, i) => placements.push({ studentUserId, key, rollNo: i + 1 }));
  }

  const termCodes = new Set<string>([...input.sessions.map((s) => s.semester), ...input.enrollments.map((e) => e.semester)]);
  const batches = new Map<string, { levelId: number; term: string }>();
  for (const key of sections.values()) batches.set(batchKeyString(key), { levelId: key.levelId, term: key.term });

  return {
    terms: [...termCodes].sort().map((code) => ({ code, isCurrent: code === input.currentTerm })),
    subjects,
    curriculum: [...curriculum.values()],
    batches: [...batches.values()],
    sections: [...sections.values()],
    sessionLinks,
    assignments: [...assignments.values()],
    placements,
    unplacedSessions,
    placementConflicts,
    enrolledStudentsByTerm: Object.fromEntries([...enrolledByTerm].map(([t, s]) => [t, s.size])),
  };
}
