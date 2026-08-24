/**
 * SEC-2 — credential rotation tool.
 *
 * Finds accounts still using a known weak/seeded password, replaces each with a strong
 * random one, and flags them so the holder must set their own at next login.
 *
 *   npx tsx prisma/rotate-passwords.ts             # dry run — report only, no writes
 *   npx tsx prisma/rotate-passwords.ts --apply     # rotate the weak accounts
 *   npx tsx prisma/rotate-passwords.ts --apply --all
 *                                                  # rotate every account, weak or not
 *
 * Seven of the seeded teacher accounts have no email address, so new credentials cannot
 * be delivered by mail. The table printed at the end is the delivery mechanism: hand each
 * row to its owner over a channel you trust, then close the terminal.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";

const db = new PrismaClient();

/** Passwords known to have shipped in the seed or to be trivially guessable. */
const KNOWN_WEAK = ["bcsk1234", "password", "admin", "123456", "changeme"];

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

/** 18 bytes of entropy, URL-safe, no ambiguous-looking punctuation to mis-transcribe. */
const newPassword = () => randomBytes(18).toString("base64url");

async function main() {
  const users = await db.user.findMany({
    select: { id: true, loginId: true, name: true, role: true, email: true, passwordHash: true },
    orderBy: { id: "asc" },
  });

  const targets: { id: number; loginId: string; role: string; email: string | null; why: string }[] = [];
  for (const u of users) {
    if (ALL) {
      targets.push({ ...u, why: "--all" });
      continue;
    }
    for (const weak of KNOWN_WEAK) {
      if (await bcrypt.compare(weak, u.passwordHash)) {
        targets.push({ ...u, why: `known weak password "${weak}"` });
        break;
      }
    }
  }

  console.log(`Scanned ${users.length} accounts · ${targets.length} need rotation\n`);
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  for (const t of targets) console.log(`  ${t.loginId.padEnd(18)} ${t.role.padEnd(14)} ${t.why}`);

  if (!APPLY) {
    console.log("\nDry run — nothing was written. Re-run with --apply to rotate.");
    return;
  }

  // Hash outside the transaction: bcrypt is deliberately slow and must not hold locks.
  console.log("\nHashing…");
  const prepared = await Promise.all(
    targets.map(async (t) => {
      const password = newPassword();
      return { ...t, password, hash: await bcrypt.hash(password, 12) };
    })
  );

  // One transaction: either every credential is rotated and audited, or none is.
  await db.$transaction([
    ...prepared.map((p) =>
      db.user.update({
        where: { id: p.id },
        data: { passwordHash: p.hash, mustChangePassword: true, passwordChangedAt: null },
      })
    ),
    ...prepared.map((p) =>
      db.auditLog.create({
        data: {
          userId: null,
          action: "USER_PASSWORD_ROTATED",
          entity: "User",
          entityId: String(p.id),
          detail: `SEC-2 rotation (${p.why}); forced change at next login`,
        },
      })
    ),
  ]);

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      category: "auth",
      event: "credentials_rotated",
      count: prepared.length,
      loginIds: prepared.map((p) => p.loginId).join(","),
    })
  );

  // Written to a gitignored file rather than stdout: terminal scrollback gets copied into
  // tickets and chat logs, and seven of these accounts have no email fallback if leaked.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = join(process.cwd(), `rotated-credentials-${stamp}.txt`);
  const table = [
    `BCSK credential rotation — ${new Date().toISOString()}`,
    `${prepared.length} accounts rotated. Each holder must set their own password at first login.`,
    `Distribute each row over a channel you trust, then delete this file.`,
    "",
    "LOGIN ID           ROLE           EMAIL                     NEW PASSWORD",
    "-".repeat(96),
    ...prepared.map((p) =>
      [p.loginId.padEnd(18), p.role.padEnd(14), (p.email ?? "— none on file —").padEnd(25), p.password].join(" ")
    ),
    "",
  ].join("\n");
  writeFileSync(outFile, table, { mode: 0o600 });

  console.log(`\nRotated ${prepared.length} accounts.`);
  console.log(`New credentials written to: ${outFile}`);
  console.log("That file is gitignored. Distribute the rows securely, then delete it.");
  console.log("Accounts with no email on file (must be handed over in person):");
  console.log("  " + (prepared.filter((p) => !p.email).map((p) => p.loginId).join(", ") || "none"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
