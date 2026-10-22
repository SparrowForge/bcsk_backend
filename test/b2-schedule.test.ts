import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { assertNoClash, findClashes, type Slot } from "../src/modules/schedule/clash";
import { joinable, OnlineClassService } from "../src/modules/schedule/online-class.service";
import { CalendarService } from "../src/modules/schedule/calendar.service";
import { RoutineService, byWeekTime } from "../src/modules/schedule/routine.service";
import { studentSlotsWhere } from "../src/modules/schedule/class-scope";
import { eventSchema, onlineClassSchema, rangeSchema, slotSchema } from "../src/modules/schedule/schedule.schema";
import { CalendarController, RoutineController } from "../src/modules/schedule/schedule.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";

type Grid = { access: boolean; insert: boolean; update: boolean; delete: boolean };
const actorOf = (role: Role, menus?: Record<string, Partial<Grid>>, instituteId = 1): Actor => ({
  userId: 7, loginId: "x", role, name: "X", instituteId, mustChangePassword: false, transport: "cookie",
  menus: menus
    ? Object.fromEntries(Object.entries(menus).map(([k, g]) => [k, { access: false, insert: false, update: false, delete: false, ...g }]))
    : undefined,
});

async function run(target: object, handlerName: string, actor: Actor | null, method = "GET") {
  const guard = new AuthGuard(new Reflector(), { resolveActor: async () => actor } as never);
  const proto = (target as { prototype: Record<string, () => void> }).prototype;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: "/x", method, headers: {}, cookies: {} }) }),
    getHandler: () => proto[handlerName],
    getClass: () => target,
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

/* ------------------------------------------------------------------ clash rules */

const slot = (over: Partial<Slot>): Slot => ({
  id: 1, title: "Class 3 A - Bangla", dayOfWeek: "Saturday", startTime: "10:00", endTime: "11:00",
  sectionId: 10, teacherId: 5, room: null, ...over,
});

describe("routine clash rules", () => {
  const candidate = slot({ id: undefined, sectionId: 20, teacherId: 6, room: null });
  it("finds a teacher in two places at once", () => {
    expect(findClashes({ ...candidate, teacherId: 5 }, [slot({})])).toEqual([{ kind: "teacher", slotId: 1, title: "Class 3 A - Bangla" }]);
  });
  it("finds a section with two classes at once", () => {
    expect(findClashes({ ...candidate, sectionId: 10, startTime: "10:30", endTime: "11:30" }, [slot({})]).map((c) => c.kind)).toEqual(["section"]);
  });
  it("finds a double-booked room, ignoring case, but never 'Online'", () => {
    expect(findClashes({ ...candidate, room: "room 2" }, [slot({ room: "Room 2" })]).map((c) => c.kind)).toEqual(["room"]);
    expect(findClashes({ ...candidate, room: "Online" }, [slot({ room: "online" })])).toEqual([]);
  });
  it("lets back-to-back classes touch without clashing", () => {
    expect(findClashes({ ...candidate, teacherId: 5, startTime: "11:00", endTime: "12:00" }, [slot({})])).toEqual([]);
  });
  it("ignores other weekdays and the slot itself", () => {
    expect(findClashes({ ...candidate, teacherId: 5, dayOfWeek: "Sunday" }, [slot({})])).toEqual([]);
    expect(findClashes(slot({}), [slot({})])).toEqual([]);
  });
  it("treats a slot with no end time as running an hour", () => {
    expect(findClashes({ ...candidate, teacherId: 5, startTime: "10:45", endTime: "11:15" }, [slot({ endTime: null })]).map((c) => c.kind)).toEqual(["teacher"]);
    expect(findClashes({ ...candidate, teacherId: 5, startTime: "11:00", endTime: "11:30" }, [slot({ endTime: null })])).toEqual([]);
  });
  it("refuses a clash with 409 and names the slot it clashes with", async () => {
    const findMany = vi.fn(async () => [slot({})]);
    await expect(assertNoClash({ classSession: { findMany } } as never, { ...candidate, teacherId: 5, semester: "2026-2", instituteId: 3 }))
      .rejects.toMatchObject({ code: "CONFLICT", details: { clash: "teacher", slotId: 1 } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ semester: "2026-2", dayOfWeek: "Saturday", active: true, course: { instituteId: 3 } }),
    }));
  });
  it("does not query at all for a slot with no teacher, section or room", async () => {
    const findMany = vi.fn();
    await assertNoClash({ classSession: { findMany } } as never, { ...candidate, teacherId: null, sectionId: null, room: null, semester: "2026-2", instituteId: 1 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it("orders a week Saturday first, then by time", () => {
    const rows = [
      { dayOfWeek: "Monday", startTime: "09:00" }, { dayOfWeek: "Saturday", startTime: "14:00" }, { dayOfWeek: "Saturday", startTime: "10:00" },
    ];
    expect(byWeekTime(rows).map((r) => `${r.dayOfWeek} ${r.startTime}`)).toEqual(["Saturday 10:00", "Saturday 14:00", "Monday 09:00"]);
  });
});

/* ------------------------------------------------------------------ routine service */

describe("routine builder", () => {
  const section = { id: 10, name: "A", active: true, batch: { term: { code: "2026-2" }, courseLevel: { id: 3, code: "CLASS_3", name: "Class 3", courseId: 1 } } };
  const prismaFor = (opts: { assigned: number[]; clashes?: Slot[] }) => ({
    section: { findFirst: vi.fn(async () => section) },
    subject: { findFirst: vi.fn(async () => ({ id: 2, name: "Bangla" })) },
    curriculumSubject: { findUnique: vi.fn(async () => ({ id: 1 })) },
    teacherAssignment: { findMany: vi.fn(async () => opts.assigned.map((t) => ({ teacherProfileId: t }))) },
    classSession: { findMany: vi.fn(async () => opts.clashes ?? []), create: vi.fn(async ({ data }: { data: object }) => ({ id: 99, ...data })) },
  });
  const input = { sectionId: 10, subjectId: 2, teacherProfileId: null, dayOfWeek: "Saturday" as const, startTime: "10:00", endTime: "11:00", room: null, zoomLink: null };

  it("creates a slot for the only teacher assigned, keyed the way older readers expect", async () => {
    const prisma = prismaFor({ assigned: [5] });
    await new RoutineService(prisma as never, { record: vi.fn() } as never).createSlot(actorOf("HEAD_MASTER"), input);
    expect(prisma.classSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teacherId: 5, sectionId: 10, subjectId: 2, classLevel: "CLASS_3", semester: "2026-2", title: "Class 3 A - Bangla" }),
    }));
  });
  it("refuses a teacher who is not assigned to the subject in that section", async () => {
    const prisma = prismaFor({ assigned: [5] });
    await expect(new RoutineService(prisma as never, { record: vi.fn() } as never).createSlot(actorOf("HEAD_MASTER"), { ...input, teacherProfileId: 6 }))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.classSession.create).not.toHaveBeenCalled();
  });
  it("refuses a clashing slot with 409 and writes nothing", async () => {
    const prisma = prismaFor({ assigned: [5], clashes: [slot({ id: 4, sectionId: 99, teacherId: 5 })] });
    await expect(new RoutineService(prisma as never, { record: vi.fn() } as never).createSlot(actorOf("HEAD_MASTER"), input))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(prisma.classSession.create).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ online classes */

describe("online class join window", () => {
  const at = (iso: string) => new Date(iso);
  const o = { status: "SCHEDULED", startsAt: at("2026-11-07T09:30:00Z"), endsAt: at("2026-11-07T10:30:00Z") };
  it("opens ten minutes before the start and closes at the end", () => {
    expect(joinable(o, at("2026-11-07T09:19:00Z"))).toBe(false);
    expect(joinable(o, at("2026-11-07T09:20:00Z"))).toBe(true);
    expect(joinable(o, at("2026-11-07T10:30:00Z"))).toBe(true);
    expect(joinable(o, at("2026-11-07T10:31:00Z"))).toBe(false);
  });
  it("is always open while live and never once ended or cancelled", () => {
    expect(joinable({ ...o, status: "LIVE" }, at("2026-11-07T12:00:00Z"))).toBe(true);
    expect(joinable({ ...o, status: "ENDED" }, at("2026-11-07T09:45:00Z"))).toBe(false);
    expect(joinable({ ...o, status: "CANCELLED" }, at("2026-11-07T09:45:00Z"))).toBe(false);
  });
});

describe("online class service", () => {
  const now = Date.now();
  const live = { id: 1, classSessionId: 50, status: "LIVE", startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000), joinUrl: null, classSession: { zoomLink: "https://zoom.us/j/1" } };
  const studentPrisma = (row: object | null) => ({
    academicTerm: { findFirst: vi.fn(async () => ({ code: "2026-2" })) },
    onlineClass: { findFirst: vi.fn(async () => row) },
    onlineClassJoin: { createMany: vi.fn(async () => ({ count: 1 })) },
  });

  it("hands a member the link and logs the join once", async () => {
    const prisma = studentPrisma(live);
    const res = await new OnlineClassService(prisma as never, {} as never).join(actorOf("STUDENT"), 1);
    expect(res).toEqual({ joinUrl: "https://zoom.us/j/1" });
    expect(prisma.onlineClassJoin.createMany).toHaveBeenCalledWith({ data: [{ onlineClassId: 1, userId: 7 }], skipDuplicates: true });
    // Membership is part of the lookup itself: the student's own slots this term.
    expect(prisma.onlineClass.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, classSession: studentSlotsWhere(actorOf("STUDENT"), "2026-2") },
    }));
  });
  it("answers not found to a student outside the class", async () => {
    await expect(new OnlineClassService(studentPrisma(null) as never, {} as never).join(actorOf("STUDENT"), 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("keeps the link back until the class opens", async () => {
    const early = { ...live, status: "SCHEDULED", startsAt: new Date(now + 3_600_000), endsAt: new Date(now + 7_200_000) };
    const prisma = studentPrisma(early);
    await expect(new OnlineClassService(prisma as never, {} as never).join(actorOf("STUDENT"), 1)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.onlineClassJoin.createMany).not.toHaveBeenCalled();
  });

  const teacherPrisma = (status: string) => {
    const tx = vi.fn(async (ops: unknown[]) => ops);
    return {
      prisma: {
        onlineClass: {
          findUnique: vi.fn(async () => ({ id: 1, classSessionId: 50, status, startsAt: new Date(now + 3_600_000) })),
          update: vi.fn((args: unknown) => args), count: vi.fn(async () => 0),
        },
        classSession: {
          findFirst: vi.fn(async () => ({ id: 50, title: "Class 3 A - Bangla", sectionId: 10, isLive: false, liveSince: null, teacher: { userId: 7 } })),
          update: vi.fn((args: unknown) => args),
        },
        teacherAssignment: { findFirst: vi.fn(async () => null) },
        sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900 }, { studentUserId: 901 }]) },
        enrollment: { findMany: vi.fn(async () => [{ studentUserId: 901 }]) },
        notification: { createMany: vi.fn((args: unknown) => args) },
        $transaction: tx,
      },
      tx,
    };
  };
  it("starts a scheduled class and puts its slot live on the boards", async () => {
    const { prisma } = teacherPrisma("SCHEDULED");
    await new OnlineClassService(prisma as never, { record: vi.fn() } as never).start(actorOf("TEACHER"), 1);
    expect(prisma.onlineClass.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "LIVE" }) }));
    expect(prisma.classSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isLive: true }) }));
  });
  it("refuses to start an ended class or end one that is not live", async () => {
    await expect(new OnlineClassService(teacherPrisma("ENDED").prisma as never, { record: vi.fn() } as never).start(actorOf("TEACHER"), 1))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(new OnlineClassService(teacherPrisma("SCHEDULED").prisma as never, { record: vi.fn() } as never).end(actorOf("TEACHER"), 1, null))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("tells each student once when a class is cancelled", async () => {
    const { prisma } = teacherPrisma("SCHEDULED");
    const res = await new OnlineClassService(prisma as never, { record: vi.fn() } as never).cancel(actorOf("TEACHER"), 1, "Teacher is unwell.");
    expect(res).toMatchObject({ status: "CANCELLED", notified: 2 });
    const sent = (prisma.notification.createMany.mock.calls[0]![0] as { data: { userId: number; body: string }[] }).data;
    expect(sent.map((n) => n.userId).sort()).toEqual([900, 901]);
    expect(sent[0]!.body).toContain("Teacher is unwell.");
  });
  it("refuses a teacher who does not own the class", async () => {
    const { prisma } = teacherPrisma("SCHEDULED");
    prisma.classSession.findFirst = vi.fn(async () => ({ id: 50, title: "x", sectionId: 10, subjectId: 2, isLive: false, liveSince: null, teacher: { userId: 999 } })) as never;
    await expect(new OnlineClassService(prisma as never, { record: vi.fn() } as never).start(actorOf("TEACHER"), 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* ------------------------------------------------------------------ calendar */

describe("calendar feeds", () => {
  const capture = () => {
    const calls: { where: Record<string, unknown> }[] = [];
    const prisma = {
      calendarEvent: { findMany: vi.fn(async (args: { where: Record<string, unknown> }) => { calls.push(args); return []; }) },
      sectionEnrollment: { findMany: vi.fn(async () => [{ batch: { courseLevelId: 3 } }]) },
    };
    return { calls, svc: new CalendarService(prisma as never, {} as never) };
  };
  const range = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") };

  it("shows a student published entries for everyone or students, and only their own class's", async () => {
    const { calls, svc } = capture();
    await svc.feed(actorOf("STUDENT"), range);
    expect(calls[0]!.where).toMatchObject({
      instituteId: 1, published: true, audience: { in: ["ALL", "STUDENTS"] },
      OR: [{ courseLevelId: null }, { courseLevelId: { in: [3] } }],
    });
  });
  it("shows a teacher entries for everyone or teachers", async () => {
    const { calls, svc } = capture();
    await svc.feed(actorOf("TEACHER"), range);
    expect(calls[0]!.where).toMatchObject({ published: true, audience: { in: ["ALL", "TEACHERS"] } });
  });
  it("shows staff every published entry, and never drafts to anyone", async () => {
    const { calls, svc } = capture();
    await svc.feed(actorOf("HEAD_MASTER"), range);
    expect(calls[0]!.where).toMatchObject({ published: true, instituteId: 1 });
    expect(calls[0]!.where.audience).toBeUndefined();
  });
  it("gives the public site only the school's open, class-free entries", async () => {
    const { calls, svc } = capture();
    await svc.publicFeed(range);
    expect(calls[0]!.where).toMatchObject({ instituteId: 1, published: true, audience: "ALL", courseLevelId: null });
  });
});

/* ------------------------------------------------------------------ routes and guards */

describe("B2 routes", () => {
  it("lets every signed-in role read its calendar, and the public read the school's", async () => {
    for (const role of ["STUDENT", "TEACHER", "IT_SUPPORT", "HEAD_MASTER"] as Role[]) {
      await expect(run(CalendarController, "feed", actorOf(role))).resolves.toBe(true);
    }
    await expect(run(CalendarController, "feed", null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(run(CalendarController, "publicFeed", null)).resolves.toBe(true);
  });
  it("keeps calendar writing to the Head Master", async () => {
    await expect(run(CalendarController, "create", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    for (const role of ["STUDENT", "TEACHER", "ADMIN_SUPPORT", "IT_SUPPORT"] as Role[]) {
      await expect(run(CalendarController, "create", actorOf(role), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("keeps the routine builder to scheduling staff", async () => {
    await expect(run(RoutineController, "create", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    await expect(run(RoutineController, "create", actorOf("ADMIN_SUPPORT"), "POST")).resolves.toBe(true);
    await expect(run(RoutineController, "create", actorOf("IT_SUPPORT"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(RoutineController, "slots", actorOf("TEACHER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("lets a student join with read access only, since joining is reading", async () => {
    await expect(run(ClassroomController, "joinOnline", actorOf("STUDENT", { "classroom.routine": { access: true } }), "POST")).resolves.toBe(true);
    await expect(run(ClassroomController, "joinOnline", actorOf("STUDENT", { "classroom.routine": {} }), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("asks a teacher for the Update switch to start, end or cancel, and Insert to schedule", async () => {
    const insertOnly = actorOf("TEACHER", { "office.classes": { access: true, insert: true } });
    await expect(run(OfficeController, "scheduleOnline", insertOnly, "POST")).resolves.toBe(true);
    await expect(run(OfficeController, "startOnline", insertOnly, "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "startOnline", actorOf("TEACHER", { "office.classes": { access: true, update: true } }), "POST")).resolves.toBe(true);
  });
});

/* ------------------------------------------------------------------ input rules */

describe("schedule input validation", () => {
  it("wants 24-hour times and an end after the start", () => {
    const base = { sectionId: 1, subjectId: 1, dayOfWeek: "Saturday", startTime: "10:00", endTime: "11:00" };
    expect(slotSchema.parse(base).endTime).toBe("11:00");
    expect(() => slotSchema.parse({ ...base, endTime: "09:00" })).toThrow();
    expect(() => slotSchema.parse({ ...base, startTime: "7pm" })).toThrow();
    expect(() => slotSchema.parse({ ...base, dayOfWeek: "Funday" })).toThrow();
  });
  it("only takes https meeting links", () => {
    const at = { startsAt: "2026-11-07T18:30:00+09:00", endsAt: "2026-11-07T19:30:00+09:00" };
    expect(onlineClassSchema.parse({ ...at, joinUrl: "https://meet.google.com/abc" }).joinUrl).toBe("https://meet.google.com/abc");
    expect(() => onlineClassSchema.parse({ ...at, joinUrl: "javascript:alert(1)" })).toThrow();
    expect(() => onlineClassSchema.parse({ ...at, joinUrl: "http://zoom.us/j/1" })).toThrow();
  });
  it("wants an offset on class times and caps a meeting at six hours", () => {
    expect(() => onlineClassSchema.parse({ startsAt: "2026-11-07T18:30:00", endsAt: "2026-11-07T19:30:00" })).toThrow();
    expect(() => onlineClassSchema.parse({ startsAt: "2026-11-07T08:00:00+09:00", endsAt: "2026-11-07T15:00:00+09:00" })).toThrow();
  });
  it("allows a one-day event and refuses one that ends before it starts", () => {
    expect(eventSchema.parse({ title: "Victory Day", type: "HOLIDAY", startDate: "2026-12-16", endDate: "2026-12-16" }).published).toBe(false);
    expect(() => eventSchema.parse({ title: "Exams", type: "EXAM", startDate: "2026-12-10", endDate: "2026-12-01" })).toThrow();
  });
  it("caps a feed range at 400 days", () => {
    expect(() => rangeSchema.parse({ from: "2026-01-01", to: "2027-12-31" })).toThrow();
    const r = rangeSchema.parse({ from: "2026-11-01" });
    expect(r.to.getTime() - r.from.getTime()).toBe(210 * 86_400_000);
  });
});
