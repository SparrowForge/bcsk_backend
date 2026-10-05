import { PrismaClient } from "@prisma/client";
import { LeadsService } from "../src/modules/leads/leads.service";
import { LeadSourcesService } from "../src/modules/leads/lead-sources.service";
import { AuditService } from "../src/common/audit.service";

const prisma = new PrismaClient();
const svc = new LeadsService(prisma as never, new AuditService(prisma as never));
const srcSvc = new LeadSourcesService(prisma as never);
const ok = (n: string, c: unknown) => { console.log(c ? "PASS" : "FAIL", n); if (!c) process.exitCode = 1; };
const rejects = async (n: string, p: Promise<unknown>, re: RegExp) => {
  try { await p; ok(n, false); } catch (e) { ok(`${n} (${(e as Error).message.slice(0, 60)})`, re.test((e as Error).message)); }
};

(async () => {
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN", active: true } });
  if (!admin) throw new Error("no admin");
  const actor = { userId: admin.id, loginId: admin.loginId, role: "SUPER_ADMIN", name: admin.name, mustChangePassword: false, transport: "system" } as never;
  const tag = `ZZTEST-${Date.now()}`;
  const created: number[] = [];
  let srcId = 0, appId = 0;
  try {
    const src = await srcSvc.create({ name: tag, isPublic: true } as never); srcId = src.id;
    await rejects("duplicate source name", srcSvc.create({ name: tag } as never), /already exists/);
    ok("public source listed", (await srcSvc.publicList()).some((s) => s.id === srcId));

    const course = await prisma.course.findFirst({ where: { type: "SPECIAL", active: true } });
    const l = await svc.create({ name: `${tag} Rahim`, phone: `+8210${Date.now() % 1e8}`, email: `${tag}@example.com`.toLowerCase(), sourceId: srcId, courseId: course?.id, assignedToUserId: admin.id } as never, actor);
    created.push(l.id);
    ok("lead created with LD number", /^LD-\d{4}-\d{4,}$/.test(l.leadNo));
    ok("stage NEW score 10, owner set", l.stage === "NEW" && l.score === 10 && l.assignedToUserId === admin.id);
    await rejects("duplicate lead blocked", svc.create({ name: "x y", email: l.email } as never, actor), /already exists/);
    ok("findDuplicate", (await svc.findDuplicate(l.email, null))?.id === l.id);

    const q = await svc.setStage(l.id, { stage: "QUALIFIED" } as never, actor);
    ok("stage -> QUALIFIED score 50", q.stage === "QUALIFIED" && q.score === 50);
    await rejects("ENROLLED by stage blocked", svc.setStage(l.id, { stage: "ENROLLED" } as never, actor), /converted/i);
    await rejects("LOST needs reason", svc.setStage(l.id, { stage: "LOST" } as never, actor), /why/i);

    await svc.logActivity(l.id, { type: "CALL", subject: "Intro call", completedAt: new Date().toISOString(), nextFollowUpAt: new Date(Date.now() - 3600e3).toISOString() } as never, actor);
    const afterCall = await svc.one(l.id);
    ok("activity sets lastContactedAt + follow-up", !!afterCall.lastContactedAt && !!afterCall.nextFollowUpAt);
    ok("overdue follow-up listed", (await svc.dueFollowUps()).some((x) => x.id === l.id));
    ok("list search finds lead", (await svc.list({ search: tag, limit: 10 } as never)).items.some((x) => x.id === l.id));
    const acts = await svc.activities(l.id);
    ok("timeline has system + manual entries", acts.some((a) => a.isSystemGenerated) && acts.some((a) => !a.isSystemGenerated));
    const sys = acts.find((a) => a.isSystemGenerated)!;
    await rejects("system activity not deletable", svc.removeActivity(sys.id), /record/);

    ok("bulk assign", (await svc.bulkAssign({ leadIds: [l.id], assignedToUserId: null } as never, actor)).updated === 1);
    await rejects("assign to non-staff blocked", svc.assign(l.id, { assignedToUserId: 999999 } as never, actor), /staff/);

    const f = await svc.funnel({} as never);
    ok("funnel counts", f.total >= 1 && f.byStage.find((s) => s.stage === "QUALIFIED")!.count >= 1);
    ok("board includes lead", (await svc.board()).some((x) => x.id === l.id));

    // convert: regular course needs a class
    await rejects("convert needs class", svc.convert(l.id, { type: "REGULAR" } as never, actor), /class/i);
    const lvl = await prisma.courseLevel.findFirst({ where: { course: { slug: "regular-course" }, code: { not: null } } });
    const conv = await svc.convert(l.id, { type: "REGULAR", courseLevelId: lvl!.id } as never, actor);
    appId = conv.applicationId;
    const app = await prisma.applicationForm.findUnique({ where: { id: appId } });
    ok("application prefilled", app?.applicantName === l.name && app.status === "PENDING_PAYMENT" && app.grade === lvl!.code);
    ok("lead ENROLLED + linked", conv.lead.stage === "ENROLLED" && conv.lead.convertedApplicationId === appId);
    await rejects("converted lead not editable", svc.update(l.id, { city: "x" } as never, actor), /converted/);
    await rejects("converted lead not deletable", svc.remove(l.id, actor), /converted/);

    // lost flow + soft delete/restore on second lead
    const l2 = await svc.create({ name: `${tag} Karim`, phone: `+8219${Date.now() % 1e8}` } as never, actor); created.push(l2.id);
    const lost = await svc.setStage(l2.id, { stage: "LOST", lostReason: "FEES_TOO_HIGH" } as never, actor);
    ok("lost with reason", lost.stage === "LOST" && lost.score === 0 && lost.nextFollowUpAt === null);
    await rejects("lost cannot convert", svc.convert(l2.id, {} as never, actor), /lost/i);
    await svc.remove(l2.id, actor);
    await rejects("deleted lead hidden", svc.one(l2.id), /not found/);
    ok("restore", (await svc.restore(l2.id, actor)).id === l2.id);

    // public form
    const pub = await svc.createFromPublicForm({ name: `${tag} Pub`, phone: "+821000000000", sourceId: srcId, message: "hi" } as never);
    if (pub) created.push(pub.id);
    ok("public lead NEW, source honoured", pub?.stage === "NEW" && pub.sourceId === srcId);
    ok("public repeat returns null", (await svc.createFromPublicForm({ name: "again", phone: "+821000000000" } as never)) === null);
  } finally {
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: created } } });
    await prisma.lead.deleteMany({ where: { id: { in: created } } });
    if (appId) await prisma.applicationForm.deleteMany({ where: { id: appId } });
    if (srcId) await prisma.leadSource.deleteMany({ where: { id: srcId } });
    await prisma.auditLog.deleteMany({ where: { entity: "Lead", entityId: { in: created.map(String) } } });
    const left = await prisma.lead.count({ where: { name: { startsWith: "ZZTEST-" } } });
    console.log("cleanup leftover leads:", left);
    await prisma.$disconnect();
  }
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
