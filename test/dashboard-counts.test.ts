import { describe, it, expect } from "vitest";
import { AdminService } from "@/modules/admin/admin.service";
import { OfficeService } from "@/modules/office/office.service";

/**
 * Dashboard counts, encoded because every one of these was a *silent* wrong number.
 *
 * Nothing threw and no page broke — the cards simply reported a figure that did not mean
 * what its label said, which is the one class of bug a reader cannot catch by looking.
 *
 * These assert the shape of the Prisma query rather than a result, so they stay
 * database-free like the rest of the suite.
 */

/** Records the `where`/`include` each delegate was called with, and returns 0 rows. */
function recordingPrisma() {
  const calls: Record<string, unknown[]> = {};
  const record = (key: string) => (args?: unknown) => {
    (calls[key] ??= []).push(args);
    return Promise.resolve(key.endsWith("count") ? 0 : []);
  };
  const prisma = {
    payment: { count: record("payment.count") },
    applicationForm: { count: record("applicationForm.count") },
    supportTicket: { count: record("supportTicket.count") },
    studentProfile: { count: record("studentProfile.count") },
    teacherProfile: {
      count: record("teacherProfile.count"),
      findUnique: () => Promise.resolve({ id: 1, userId: 1 }),
    },
    question: { count: record("question.count") },
    classSession: { findMany: record("classSession.findMany") },
    notification: { findMany: record("notification.findMany") },
  };
  return { prisma, calls };
}

const adminService = () => {
  const { prisma, calls } = recordingPrisma();
  // Only `prisma` is exercised by dashboard()/listSessions(); the rest are unused collaborators.
  return { svc: new AdminService(prisma as never, {} as never, {} as never, {} as never), calls };
};

const officeService = () => {
  const { prisma, calls } = recordingPrisma();
  return { svc: new OfficeService(prisma as never), calls };
};

describe("admin dashboard counts mean what their labels say", () => {
  /**
   * Deactivation is a soft flag (`user.setActive` writes `active: false` and keeps the row),
   * so a bare `studentProfile.count()` reported every account ever switched off under a card
   * labelled "Active students".
   */
  it("counts only students whose user account is active", async () => {
    const { svc, calls } = adminService();
    await svc.dashboard();
    expect(calls["studentProfile.count"][0]).toEqual({ where: { user: { active: true } } });
  });

  it("counts only teachers whose user account is active", async () => {
    const { svc, calls } = adminService();
    await svc.dashboard();
    expect(calls["teacherProfile.count"][0]).toEqual({ where: { user: { active: true } } });
  });

  /**
   * APPROVED and REJECTED are the only terminal statuses. CORRECTIONS_REQUESTED was left out
   * of the "open" list, so an application handed back to the applicant sat in flight while
   * appearing in no count at all.
   */
  it("treats every non-terminal application status as open", async () => {
    const { svc, calls } = adminService();
    await svc.dashboard();
    const arg = calls["applicationForm.count"][0] as { where: { status: { in: string[] } } };
    expect([...arg.where.status.in].sort()).toEqual(
      ["CORRECTIONS_REQUESTED", "PAID", "PENDING_PAYMENT", "PENDING_VERIFICATION"].sort(),
    );
    expect(arg.where.status.in).not.toContain("APPROVED");
    expect(arg.where.status.in).not.toContain("REJECTED");
  });

  it("counts unanswered questions by answeredAt, which is the indexed column", async () => {
    const { svc, calls } = adminService();
    await svc.dashboard();
    expect(calls["question.count"][0]).toEqual({ where: { answeredAt: null } });
  });
});

describe("a class reports the same roster size everywhere (office + admin)", () => {
  /**
   * `office.dashboard` filtered enrolments to ACTIVE while `office.myClasses` and
   * `admin.listSessions` did not, so the same class showed one number on the teacher's
   * dashboard and a larger one — inflated by CANCELLED/COMPLETED rows — on their classes
   * page and in admin scheduling.
   */
  const activeOnly = { select: { enrollments: { where: { status: "ACTIVE" } } } };

  it("office dashboard counts active enrolments only", async () => {
    const { svc, calls } = officeService();
    await svc.dashboard({ userId: 1 } as never);
    const arg = calls["classSession.findMany"][0] as { include: { _count: unknown } };
    expect(arg.include._count).toEqual(activeOnly);
  });

  it("office myClasses counts active enrolments only", async () => {
    const { svc, calls } = officeService();
    await svc.myClasses({ userId: 1 } as never);
    const arg = calls["classSession.findMany"][0] as { include: { _count: unknown } };
    expect(arg.include._count).toEqual(activeOnly);
  });

  it("admin scheduling counts active enrolments only", async () => {
    const { svc, calls } = adminService();
    await svc.listSessions();
    const arg = calls["classSession.findMany"][0] as { include: { _count: unknown } };
    expect(arg.include._count).toEqual(activeOnly);
  });

  it("office dashboard counts its teacher's unanswered questions by answeredAt", async () => {
    const { svc, calls } = officeService();
    await svc.dashboard({ userId: 7 } as never);
    expect(calls["question.count"][0]).toEqual({
      where: { teacherUserId: 7, answeredAt: null },
    });
  });
});
