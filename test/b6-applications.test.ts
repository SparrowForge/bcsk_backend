import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { assertMove, canMove, daysInclusive, excusedMarks, LEAVE_FLOW, TRANSFER_FLOW } from "../src/modules/application/workflow";
import { decisionSchema, leaveSchema } from "../src/modules/application/application.schema";
import { LeaveService } from "../src/modules/application/leave.service";
import { TransferService } from "../src/modules/application/transfer.service";
import { ApplicationController } from "../src/modules/application/application.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { FileService } from "../src/modules/file/file.service";

type Grid = { access: boolean; insert: boolean; update: boolean; delete: boolean };
const actorOf = (role: Role, opts: { userId?: number; menus?: Record<string, Partial<Grid>> } = {}): Actor => ({
  userId: opts.userId ?? 7, loginId: "x", role, name: "Arif", instituteId: 1, mustChangePassword: false, transport: "cookie",
  menus: opts.menus
    ? Object.fromEntries(Object.entries(opts.menus).map(([k, g]) => [k, { access: false, insert: false, update: false, delete: false, ...g }]))
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
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

/* ------------------------------------------------------------------ workflows */

describe("application workflows", () => {
  it("lets leave move only forward, and never out of a decision", () => {
    expect(canMove(LEAVE_FLOW, "PENDING", "REVIEWED")).toBe(true);
    expect(canMove(LEAVE_FLOW, "PENDING", "APPROVED")).toBe(true);
    expect(canMove(LEAVE_FLOW, "REVIEWED", "REJECTED")).toBe(true);
    for (const from of ["APPROVED", "REJECTED", "CANCELLED"]) {
      for (const to of ["PENDING", "REVIEWED", "APPROVED", "REJECTED", "CANCELLED"]) expect(canMove(LEAVE_FLOW, from, to)).toBe(false);
    }
  });
  it("lets a transfer be approved only after verification", () => {
    expect(canMove(TRANSFER_FLOW, "SUBMITTED", "APPROVED")).toBe(false);
    expect(canMove(TRANSFER_FLOW, "VERIFIED", "APPROVED")).toBe(true);
    expect(canMove(TRANSFER_FLOW, "SUBMITTED", "REJECTED")).toBe(true);
    expect(canMove(TRANSFER_FLOW, "APPROVED", "CANCELLED")).toBe(false);
  });
  it("refuses an illegal move with 409", () => {
    expect(() => assertMove(LEAVE_FLOW, "APPROVED", "REJECTED", "leave request")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });
  it("counts leave days inclusively and excuses only classes that meet on those weekdays", () => {
    expect(daysInclusive(day("2026-11-07"), day("2026-11-07"))).toBe(1);
    expect(daysInclusive(day("2026-11-07"), day("2026-11-09"))).toBe(3);
    // Sat 7 Nov - Mon 9 Nov 2026: the Saturday and Monday classes, not the Wednesday one.
    const marks = excusedMarks([{ id: 1, dayOfWeek: "Saturday" }, { id: 2, dayOfWeek: "Monday" }, { id: 3, dayOfWeek: "Wednesday" }], day("2026-11-07"), day("2026-11-09"));
    expect(marks.map((m) => `${m.classSessionId}@${m.date.toISOString().slice(0, 10)}`)).toEqual(["1@2026-11-07", "2@2026-11-09"]);
  });
  it("needs a reason to reject, and leave that ends after it starts", () => {
    expect(() => decisionSchema.parse({ decision: "REJECT" })).toThrow();
    expect(decisionSchema.parse({ decision: "APPROVE" }).note).toBeNull();
    expect(() => leaveSchema.parse({ fromDate: "2026-11-09", toDate: "2026-11-07", reason: "Family wedding" })).toThrow();
  });
});

/* ------------------------------------------------------------------ leave */

function leavePrisma(opts: { status?: string; days?: number; classTeacherProfile?: number; maxDays?: number; overlap?: boolean } = {}) {
  return {
    leaveApplication: {
      findFirst: vi.fn(async (args: { where: { status?: unknown } }) => {
        if (args.where.status) return opts.overlap ? { id: 9 } : null; // the overlap check
        return { id: 3, status: opts.status ?? "PENDING", studentUserId: 900, sectionId: 10, days: opts.days ?? 2, fromDate: day("2026-11-07"), toDate: day("2026-11-08") };
      }),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 3, student: { name: "Arif" }, ...data })),
      update: vi.fn((a: { data: object }) => ({ ...a.data, student: { name: "Arif" } })),
    },
    sectionEnrollment: {
      findMany: vi.fn(async () => [{ sectionId: 10, section: { classTeacher: { userId: 70 } }, batch: { courseLevel: { course: { type: "REGULAR" } } } }]),
    },
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 5 })) },
    section: { findMany: vi.fn(async () => (opts.classTeacherProfile === 5 ? [{ id: 10 }] : [])) },
    institute: { findUniqueOrThrow: vi.fn(async () => ({ leaveTeacherMaxDays: opts.maxDays ?? 0 })) },
    academicTerm: { findFirst: vi.fn(async () => ({ code: "2026-2" })) },
    classSession: { findMany: vi.fn(async () => [{ id: 50, dayOfWeek: "Saturday" }, { id: 51, dayOfWeek: "Sunday" }, { id: 52, dayOfWeek: "Tuesday" }]) },
    attendance: { upsert: vi.fn((a: unknown) => a) },
    notification: { create: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn(async () => [{ id: 1 }]) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}
const audit = () => ({ record: vi.fn() });
const student = actorOf("STUDENT", { userId: 900 });

describe("leave", () => {
  it("files a request against the student's class section and tells the class teacher", async () => {
    const prisma = leavePrisma();
    await new LeaveService(prisma as never, audit() as never).apply(student, { fromDate: day(today()), toDate: day(today()), reason: "Fever", attachmentUrl: null });
    expect(prisma.leaveApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sectionId: 10, days: 1, studentUserId: 900 }) }));
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 70, title: "Leave request to review" }) }));
  });
  it("refuses more than 60 days, a start over 30 days back, and overlapping leave", async () => {
    const svc = new LeaveService(leavePrisma() as never, audit() as never);
    const t = day(today());
    await expect(svc.apply(student, { fromDate: t, toDate: new Date(t.getTime() + 60 * 86_400_000), reason: "Travel", attachmentUrl: null })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(svc.apply(student, { fromDate: new Date(t.getTime() - 31 * 86_400_000), toDate: t, reason: "Late", attachmentUrl: null })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(new LeaveService(leavePrisma({ overlap: true }) as never, audit() as never).apply(student, { fromDate: t, toDate: t, reason: "Again", attachmentUrl: null }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("lets only the student's class teacher review", async () => {
    await expect(new LeaveService(leavePrisma({ classTeacherProfile: 99 }) as never, audit() as never).review(actorOf("TEACHER"), 3, "APPROVE", null))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("passes a review on to the Head Master when the leave is longer than a teacher may decide", async () => {
    const prisma = leavePrisma({ classTeacherProfile: 5, maxDays: 0 });
    const res = await new LeaveService(prisma as never, audit() as never).review(actorOf("TEACHER"), 3, "APPROVE", "Genuine");
    expect(res).toMatchObject({ status: "REVIEWED", recommendation: "APPROVE" });
    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
  });
  it("lets the class teacher approve short leave alone, excusing the student's classes on those days", async () => {
    const prisma = leavePrisma({ classTeacherProfile: 5, maxDays: 3, days: 2 });
    const res = await new LeaveService(prisma as never, audit() as never).review(actorOf("TEACHER"), 3, "APPROVE", null);
    expect(res).toMatchObject({ status: "APPROVED", excusedMarks: 2 }); // Sat 7 and Sun 8 Nov; not Tuesday
    const written = prisma.attendance.upsert.mock.calls.map((c) => (c[0] as { create: { classSessionId: number; status: string; remark: string } }).create);
    expect(written.map((w) => w.classSessionId)).toEqual([50, 51]);
    expect(written.every((w) => w.status === "EXCUSED" && w.remark === "Leave #3")).toBe(true);
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 900, title: "Leave approved" }) }));
  });
  it("refuses to decide a request twice, and the student cancelling a decided one", async () => {
    await expect(new LeaveService(leavePrisma({ status: "APPROVED" }) as never, audit() as never).decide(actorOf("HEAD_MASTER"), 3, "REJECT", "Changed my mind"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(new LeaveService(leavePrisma({ status: "REJECTED" }) as never, audit() as never).cancel(student, 3)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/* ------------------------------------------------------------------ transfer */

function transferPrisma(status: string, opts: { open?: boolean } = {}) {
  return {
    transferApplication: {
      findFirst: vi.fn(async (args: { where: { status?: unknown } }) => {
        if (args.where.status) return opts.open ? { id: 1 } : null;
        return { id: 4, status, studentUserId: 900, destination: "Seoul Global School", reason: "Moving", effectiveDate: day("2026-12-01"), duesCleared: false, libraryCleared: false };
      }),
      create: vi.fn(async ({ data }: { data: object }) => data),
      update: vi.fn((a: { data: object }) => a.data),
    },
    studentProfile: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })), update: vi.fn((a: unknown) => a) },
    sectionEnrollment: { findFirst: vi.fn(async () => ({ sectionId: 10 })), updateMany: vi.fn((a: unknown) => a) },
    enrollment: { updateMany: vi.fn((a: unknown) => a) },
    certificate: { create: vi.fn((a: unknown) => a) },
    notification: { create: vi.fn((a: unknown) => a), createMany: vi.fn() },
    user: { findMany: vi.fn(async () => [{ id: 1 }, { id: 2 }]) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}
const reports = () => ({
  values: vi.fn(async () => ({ name: "Arif", studentId: "BCSK-2026-0001", class: "Class 2", institute: "BCSK", date: "2026-10-22", _sectionId: 10 })),
  render: vi.fn(async () => ({ title: "Transfer Certificate", body: "text", signatoryName: null, signatoryTitle: "Head Master" })),
  reprint: vi.fn(),
});

describe("transfer", () => {
  it("refuses a second open request", async () => {
    await expect(new TransferService(transferPrisma("SUBMITTED", { open: true }) as never, audit() as never, reports() as never)
      .apply(student, { destination: "X", reason: "Moving", effectiveDate: day("2026-12-01") })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("keeps a partly cleared request with the office, and verifies it once both are cleared", async () => {
    const office = actorOf("ADMIN_SUPPORT");
    const partial = transferPrisma("SUBMITTED");
    await new TransferService(partial as never, audit() as never, reports() as never).verify(office, 4, { duesCleared: true, libraryCleared: false, note: "Library book out" });
    expect(partial.transferApplication.update.mock.calls[0]![0].data).not.toHaveProperty("status");
    const full = transferPrisma("SUBMITTED");
    await new TransferService(full as never, audit() as never, reports() as never).verify(office, 4, { duesCleared: true, libraryCleared: true, note: null });
    expect(full.transferApplication.update.mock.calls[0]![0].data).toMatchObject({ status: "VERIFIED", verifiedById: 7 });
  });
  it("refuses approval before the office has cleared it", async () => {
    const prisma = transferPrisma("SUBMITTED");
    await expect(new TransferService(prisma as never, audit() as never, reports() as never).decide(actorOf("HEAD_MASTER"), 4, "APPROVE", null))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("on approval issues the letter and updates the record in one transaction", async () => {
    const prisma = transferPrisma("VERIFIED");
    const r = reports();
    await new TransferService(prisma as never, audit() as never, r as never).decide(actorOf("HEAD_MASTER"), 4, "APPROVE", null);
    expect(r.render).toHaveBeenCalledWith(expect.anything(), "TRANSFER_LETTER", "en", expect.objectContaining({ destination: "Seoul Global School", effectiveDate: "2026-12-01" }));
    const ops = prisma.$transaction.mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(6);
    expect(prisma.certificate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ studentUserId: 900, type: "TRANSFER_LETTER", serial: expect.stringMatching(/^BCSK-TC-\d{4}-[0-9A-Z]{10}$/) }) }));
    expect(prisma.studentProfile.update).toHaveBeenCalledWith({ where: { userId: 900 }, data: { status: "TRANSFERRED" } });
    expect(prisma.sectionEnrollment.updateMany).toHaveBeenCalledWith({ where: { studentUserId: 900, status: "ACTIVE" }, data: { status: "TRANSFERRED" } });
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({ where: { studentUserId: 900, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  });
  it("refuses deciding a decided request", async () => {
    await expect(new TransferService(transferPrisma("APPROVED") as never, audit() as never, reports() as never).decide(actorOf("HEAD_MASTER"), 4, "REJECT", "No"))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/* ------------------------------------------------------------------ routes and files */

describe("B6 routes", () => {
  it("lets the Head Master decide leave and transfers, and the office only clear transfers", async () => {
    const hm = actorOf("HEAD_MASTER"), office = actorOf("ADMIN_SUPPORT");
    await expect(run(ApplicationController, "decideLeave", hm, "POST")).resolves.toBe(true);
    await expect(run(ApplicationController, "decideTransfer", hm, "POST")).resolves.toBe(true);
    await expect(run(ApplicationController, "verifyTransfer", office, "POST")).resolves.toBe(true);
    await expect(run(ApplicationController, "decideTransfer", office, "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ApplicationController, "decideLeave", office, "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ApplicationController, "verifyTransfer", actorOf("IT_SUPPORT"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("lets a student apply through their Documents menu, read access being enough", async () => {
    const s = actorOf("STUDENT", { menus: { "classroom.documents": { access: true } } });
    for (const h of ["applyLeave", "cancelLeave", "applyTransfer", "cancelTransfer"]) await expect(run(ClassroomController, h, s, "POST")).resolves.toBe(true);
    await expect(run(ClassroomController, "applyLeave", actorOf("STUDENT", { menus: {} }), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("asks a class teacher for the Update switch to review", async () => {
    await expect(run(OfficeController, "reviewLeave", actorOf("TEACHER", { menus: { "office.classes": { access: true, insert: true } } }), "POST"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "reviewLeave", actorOf("TEACHER", { menus: { "office.classes": { access: true, update: true } } }), "POST"))
      .resolves.toBe(true);
  });
  it("lets leave notes be read by students, teachers and leave staff only", () => {
    const files = new FileService({} as never);
    expect(() => files.authorise("leave/0123456789abcdef.pdf", actorOf("HEAD_MASTER"))).not.toThrow();
    expect(() => files.authorise("leave/0123456789abcdef.pdf", actorOf("TEACHER"))).not.toThrow();
    expect(() => files.authorise("leave/0123456789abcdef.pdf", actorOf("IT_SUPPORT"))).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
