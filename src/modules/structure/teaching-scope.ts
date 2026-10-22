import type { PrismaService } from "../../database/prisma.service";
import type { Actor } from "../../common/actor";
import { forbidden, notFound } from "../../common/errors/app-error";

/**
 * Which sections a teacher may act in - the rule every teacher-facing LMS route calls.
 *
 * A teacher teaches a section when a `TeacherAssignment` names them for it (for `subjectId`,
 * when one is given), or - for section-wide work with no subject, such as the roster or daily
 * attendance - when they are its class teacher. Anything else is refused, whatever menus the
 * account holds: the menu says a teacher may record attendance, this says for whom.
 */
export async function teacherProfileId(prisma: Pick<PrismaService, "teacherProfile">, actor: Actor): Promise<number> {
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  if (!profile) throw notFound("Teacher profile");
  return profile.id;
}

export async function assertTeaches(
  prisma: Pick<PrismaService, "teacherProfile" | "section" | "teacherAssignment">,
  actor: Actor,
  sectionId: number,
  subjectId?: number,
): Promise<{ teacherProfileId: number; isClassTeacher: boolean }> {
  const profileId = await teacherProfileId(prisma, actor);
  const [section, assignment] = await Promise.all([
    prisma.section.findFirst({
      where: { id: sectionId, batch: { term: { instituteId: actor.instituteId } } },
      select: { classTeacherId: true },
    }),
    prisma.teacherAssignment.findFirst({
      where: { teacherProfileId: profileId, sectionId, ...(subjectId != null ? { subjectId } : {}) },
      select: { id: true },
    }),
  ]);
  if (!section) throw notFound("Section");
  const isClassTeacher = section.classTeacherId === profileId;
  if (assignment || (subjectId == null && isClassTeacher)) return { teacherProfileId: profileId, isClassTeacher };
  throw forbidden(subjectId != null ? "You don't teach that subject in this section." : "That is not your section.");
}
