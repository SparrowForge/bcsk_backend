/**
 * BUG-1 — one-off backfill.
 *
 * Admission payments are created before the student account exists, so payerUserId is
 * null at insert time. Activation now adopts them inside its transaction, but rows
 * created before that fix are still orphaned: the student's Payment Report is empty and
 * /api/receipts/[id] refuses them their own receipt.
 *
 *   npx tsx prisma/backfill-payer-user-id.ts            # report only
 *   npx tsx prisma/backfill-payer-user-id.ts --apply    # write
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const orphans = await db.payment.findMany({
    where: { payerUserId: null, application: { createdStudentUserId: { not: null } } },
    include: { application: { select: { id: true, applicantName: true, createdStudentUserId: true } } },
    orderBy: { id: "asc" },
  });

  console.log(`${orphans.length} payment(s) linked to an activated application but with no payerUserId\n`);
  for (const p of orphans) {
    console.log(`  payment ${String(p.id).padEnd(5)} app ${String(p.application!.id).padEnd(5)} ` +
                `${p.purpose.padEnd(15)} -> user ${p.application!.createdStudentUserId}  (${p.application!.applicantName})`);
  }
  if (orphans.length === 0) return console.log("Nothing to backfill.");
  if (!APPLY) return console.log("\nDry run — nothing written. Re-run with --apply.");

  // Grouped by target user so this is a small number of statements, all in one transaction.
  const byUser = new Map<number, number[]>();
  for (const p of orphans) {
    const uid = p.application!.createdStudentUserId!;
    byUser.set(uid, [...(byUser.get(uid) ?? []), p.id]);
  }
  await db.$transaction(
    [...byUser].map(([userId, ids]) =>
      db.payment.updateMany({ where: { id: { in: ids } }, data: { payerUserId: userId } })
    )
  );
  console.log(`\nBackfilled ${orphans.length} payment(s) across ${byUser.size} student account(s).`);

  const left = await db.payment.count({
    where: { payerUserId: null, application: { createdStudentUserId: { not: null } } },
  });
  console.log(`Remaining orphans: ${left} (expect 0)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
