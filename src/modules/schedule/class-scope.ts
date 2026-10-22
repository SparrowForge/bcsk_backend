import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../../database/prisma.service";
import type { Actor } from "../../common/actor";
import { SEMESTER_CURRENT } from "../../common/constants";
import { forbidden, notFound } from "../../common/errors/app-error";

/**
 * Who belongs to which class slot - shared by the routine, online classes and (later)
 * attendance and materials, so the student and teacher panels apply one rule.
 *
 * A student belongs to a slot of the current term through their section (LMS B1) or through a
 * direct enrolment (the older path, still written at admission). A teacher owns a slot that
 * names them, or one teaching a section and subject they are assigned to.
 */
type Db = Pick<PrismaService, "academicTerm" | "classSession" | "sectionEnrollment" | "enrollment" | "teacherAssignment">;

/** The institute's current term code; the old constant until a current term is set. */
export async function currentTermCode(prisma: Pick<PrismaService, "academicTerm">, instituteId: number): Promise<string> {
  const term = await prisma.academicTerm.findFirst({ where: { instituteId, isCurrent: true }, select: { code: true } });
  return term?.code ?? SEMESTER_CURRENT;
}

/**
 * The `where` for the slots a student belongs to: one term's active slots, or - with a null
 * `semester` - every slot they have belonged to, for history such as past assignments.
 */
export function studentSlotsWhere(actor: Actor, semester: string | null): Prisma.ClassSessionWhereInput {
  return {
    ...(semester != null ? { active: true, semester } : {}),
    course: { instituteId: actor.instituteId },
    OR: [
      { section: { enrollments: { some: { studentUserId: actor.userId, status: "ACTIVE" } } } },
      { enrollments: { some: { studentUserId: actor.userId, status: "ACTIVE" } } },
    ],
  };
}

export async function assertStudentInSlot(prisma: Db, actor: Actor, classSessionId: number): Promise<void> {
  const semester = await currentTermCode(prisma, actor.instituteId);
  const hit = await prisma.classSession.findFirst({ where: { id: classSessionId, ...studentSlotsWhere(actor, semester) }, select: { id: true } });
  if (!hit) throw notFound("Class");
}

/**
 * The `where` for every slot a teacher teaches, in any term: those naming them, and those whose
 * exact section-and-subject pair one of their assignments holds.
 */
export async function teacherSlotsWhere(prisma: Pick<Db, "teacherAssignment">, actor: Actor): Promise<Prisma.ClassSessionWhereInput> {
  const pairs = await prisma.teacherAssignment.findMany({
    where: { teacher: { userId: actor.userId } },
    select: { sectionId: true, subjectId: true },
  });
  return {
    course: { instituteId: actor.instituteId },
    OR: [{ teacher: { userId: actor.userId } }, ...pairs.map((p) => ({ sectionId: p.sectionId, subjectId: p.subjectId }))],
  };
}

/** Load a slot the teacher owns, by the same two rules, or refuse. */
export async function assertOwnsSlot(prisma: Pick<Db, "classSession" | "teacherAssignment">, actor: Actor, classSessionId: number) {
  const cs = await prisma.classSession.findFirst({
    where: { id: classSessionId, course: { instituteId: actor.instituteId } },
    include: { teacher: { select: { userId: true } } },
  });
  if (!cs) throw notFound("Class");
  if (cs.teacher?.userId === actor.userId) return cs;
  if (cs.sectionId != null && cs.subjectId != null) {
    const assigned = await prisma.teacherAssignment.findFirst({
      where: { sectionId: cs.sectionId, subjectId: cs.subjectId, teacher: { userId: actor.userId } },
      select: { id: true },
    });
    if (assigned) return cs;
  }
  throw forbidden("That is not your class.");
}

/**
 * The students of a slot with their names, for a roster or an attendance sheet: its section's
 * active students plus anyone enrolled in it directly, roll number first, then name.
 */
export async function slotRoster(
  prisma: Pick<PrismaService, "sectionEnrollment" | "enrollment">,
  slot: { id: number; sectionId: number | null },
) {
  const student = { select: { id: true, name: true, studentProfile: { select: { studentId: true, photoUrl: true } } } } as const;
  const [placed, enrolled] = await Promise.all([
    slot.sectionId != null
      ? prisma.sectionEnrollment.findMany({ where: { sectionId: slot.sectionId, status: "ACTIVE" }, select: { rollNo: true, student } })
      : Promise.resolve([]),
    prisma.enrollment.findMany({ where: { classSessionId: slot.id, status: "ACTIVE" }, select: { student } }),
  ]);
  const byId = new Map<number, { rollNo: number | null; student: (typeof enrolled)[number]["student"] }>();
  for (const p of placed) byId.set(p.student.id, { rollNo: p.rollNo, student: p.student });
  for (const e of enrolled) if (!byId.has(e.student.id)) byId.set(e.student.id, { rollNo: null, student: e.student });
  return [...byId.values()].sort(
    (a, b) => (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || a.student.name.localeCompare(b.student.name),
  );
}

/** Every student of a slot: its section's active students plus anyone enrolled in it directly. */
export async function slotStudentIds(prisma: Pick<Db, "sectionEnrollment" | "enrollment">, slot: { id: number; sectionId: number | null }): Promise<number[]> {
  const [placed, enrolled] = await Promise.all([
    slot.sectionId != null
      ? prisma.sectionEnrollment.findMany({ where: { sectionId: slot.sectionId, status: "ACTIVE" }, select: { studentUserId: true } })
      : Promise.resolve([]),
    prisma.enrollment.findMany({ where: { classSessionId: slot.id, status: "ACTIVE" }, select: { studentUserId: true } }),
  ]);
  return [...new Set([...placed, ...enrolled].map((r) => r.studentUserId))];
}
