import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const ls = await p.lead.findMany({ where: { name: { startsWith: "ZZTEST" } }, include: { activities: true } });
  for (const l of ls) console.log(l.name, l.stage, "owner:", l.assignedToUserId, "score:", l.score, "acts:", l.activities.map(a => a.subject).join(" | "));
  const ids = ls.map(l => l.id);
  await p.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
  await p.lead.deleteMany({ where: { id: { in: ids } } });
  await p.rateLimit.deleteMany({ where: { bucket: { startsWith: "lead:" } } }).catch(() => {});
  console.log("left:", await p.lead.count({ where: { name: { startsWith: "ZZTEST" } } }));
  await p.$disconnect();
})();
