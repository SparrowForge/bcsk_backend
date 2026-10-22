import type { Prisma } from "@prisma/client";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";

/**
 * Putting a student into a section. Plain functions over a transaction client, so admission
 * activation can call them inside its own `$transaction` (BUG-2: one commit for the whole
 * activation) and the structure screens can call them inside theirs.
 */
type Tx = Prisma.TransactionClient;

/** The next free roll number in a section: one past the highest in use. */
export async function nextRollNo(tx: Tx, sectionId: number): Promise<number> {
  const top = await tx.sectionEnrollment.aggregate({ where: { sectionId }, _max: { rollNo: true } });
  return (top._max.rollNo ?? 0) + 1;
}

/**
 * Place a student in a section, or move them to it from another section of the same batch.
 * A student holds one place per batch, so a move keeps the row and changes its section; the
 * roll number is the one given, else the next free one in the new section.
 */
export async function placeInSection(
  tx: Tx,
  input: { studentUserId: number; sectionId: number; rollNo?: number | null },
) {
  const section = await tx.section.findUnique({
    where: { id: input.sectionId },
    select: { id: true, batchId: true, capacity: true, active: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
  });
  if (!section) throw notFound("Section");
  if (!section.active) throw unprocessable("That section is closed.");

  const existing = await tx.sectionEnrollment.findUnique({
    where: { studentUserId_batchId: { studentUserId: input.studentUserId, batchId: section.batchId } },
  });
  if (existing?.sectionId === section.id && existing.status === "ACTIVE" && input.rollNo == null) return existing;

  const joining = existing?.sectionId !== section.id || existing?.status !== "ACTIVE";
  if (joining && section.capacity != null && section._count.enrollments >= section.capacity) {
    throw conflict("That section is full.");
  }
  if (input.rollNo != null) {
    const taken = await tx.sectionEnrollment.findUnique({ where: { sectionId_rollNo: { sectionId: section.id, rollNo: input.rollNo } } });
    if (taken && taken.studentUserId !== input.studentUserId) throw conflict(`Roll ${input.rollNo} is already taken in this section.`);
  }
  const rollNo = input.rollNo ?? (existing?.sectionId === section.id && existing.rollNo != null ? existing.rollNo : await nextRollNo(tx, section.id));

  return existing
    ? tx.sectionEnrollment.update({ where: { id: existing.id }, data: { sectionId: section.id, rollNo, status: "ACTIVE" } })
    : tx.sectionEnrollment.create({
        data: { studentUserId: input.studentUserId, sectionId: section.id, batchId: section.batchId, rollNo },
      });
}

/**
 * The section a newly admitted student joins: in the institute's current term, the class's
 * batch, the open section with the fewest students that still has room (ties go to the first by
 * name). Returns null, placing no one, when there is no current term, no batch for the class
 * or no section with room - the office then places the student by hand.
 */
export async function autoPlace(
  tx: Tx,
  input: { studentUserId: number; courseLevelId: number; instituteId: number },
) {
  const term = await tx.academicTerm.findFirst({ where: { instituteId: input.instituteId, isCurrent: true }, select: { id: true } });
  if (!term) return null;
  const batch = await tx.batch.findUnique({
    where: { courseLevelId_termId: { courseLevelId: input.courseLevelId, termId: term.id } },
    select: {
      sections: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, capacity: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
      },
    },
  });
  const open = (batch?.sections ?? []).filter((s) => s.capacity == null || s._count.enrollments < s.capacity);
  if (open.length === 0) return null;
  const target = open.reduce((best, s) => (s._count.enrollments < best._count.enrollments ? s : best));
  return placeInSection(tx, { studentUserId: input.studentUserId, sectionId: target.id });
}
