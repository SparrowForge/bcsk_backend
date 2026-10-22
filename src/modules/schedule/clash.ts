import type { PrismaService } from "../../database/prisma.service";
import { conflict } from "../../common/errors/app-error";
import { toMinutes } from "./schedule.schema";

/**
 * Routine clash rules. Two active slots of one term on the same weekday clash when their times
 * overlap and they share a teacher, a section, or a room. Times are half-open - a class ending at
 * 11:00 and one starting at 11:00 do not clash. A slot with no end time is taken to run an hour,
 * which is how the older rows were entered. An online class has no room: "Online" never clashes.
 */
export type Slot = {
  id?: number;
  title?: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string | null;
  sectionId: number | null;
  teacherId: number | null;
  room: string | null;
};

export type Clash = { kind: "teacher" | "section" | "room"; slotId: number; title: string };

const span = (s: Slot): [number, number] => {
  const start = toMinutes(s.startTime);
  return [start, s.endTime ? toMinutes(s.endTime) : start + 60];
};
const roomKey = (room: string | null) => {
  const r = room?.trim().toLowerCase() ?? "";
  return r && r !== "online" ? r : null;
};

export function findClashes(candidate: Slot, others: Slot[]): Clash[] {
  const [a0, a1] = span(candidate);
  const out: Clash[] = [];
  for (const o of others) {
    if (o.id != null && o.id === candidate.id) continue;
    if (o.dayOfWeek !== candidate.dayOfWeek) continue;
    const [b0, b1] = span(o);
    if (!(a0 < b1 && b0 < a1)) continue;
    const base = { slotId: o.id ?? 0, title: o.title ?? "" };
    if (candidate.teacherId != null && o.teacherId === candidate.teacherId) out.push({ kind: "teacher", ...base });
    if (candidate.sectionId != null && o.sectionId === candidate.sectionId) out.push({ kind: "section", ...base });
    const room = roomKey(candidate.room);
    if (room && roomKey(o.room) === room) out.push({ kind: "room", ...base });
  }
  return out;
}

const CLASH_MESSAGE: Record<Clash["kind"], string> = {
  teacher: "The teacher already has a class then",
  section: "This section already has a class then",
  room: "The room is already booked then",
};

/**
 * Refuse a slot that clashes with another active slot of the same term in the institute, with
 * a 409 naming the first clash. `semester` is the term code the slot belongs to.
 */
export async function assertNoClash(
  prisma: Pick<PrismaService, "classSession">,
  candidate: Slot & { semester: string; instituteId: number },
): Promise<void> {
  const room = roomKey(candidate.room);
  const ors = [
    ...(candidate.teacherId != null ? [{ teacherId: candidate.teacherId }] : []),
    ...(candidate.sectionId != null ? [{ sectionId: candidate.sectionId }] : []),
    ...(room ? [{ room: { equals: candidate.room!.trim(), mode: "insensitive" as const } }] : []),
  ];
  if (ors.length === 0) return;
  const others = await prisma.classSession.findMany({
    where: {
      semester: candidate.semester,
      dayOfWeek: candidate.dayOfWeek,
      active: true,
      course: { instituteId: candidate.instituteId },
      ...(candidate.id != null ? { NOT: { id: candidate.id } } : {}),
      OR: ors,
    },
    select: { id: true, title: true, dayOfWeek: true, startTime: true, endTime: true, sectionId: true, teacherId: true, room: true },
  });
  const [first] = findClashes(candidate, others);
  if (first) {
    throw conflict(`${CLASH_MESSAGE[first.kind]}: "${first.title}".`, { clash: first.kind, slotId: first.slotId, title: first.title });
  }
}
