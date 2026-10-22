/**
 * Creates a Head Master account outside the admin UI - for testing, or to open an institute
 * before anyone can sign in to it.
 *
 *   npx tsx prisma/create-head-master.ts --login-id HM-TEST --name "Test Head Master"
 *                                                  # dry run - checks and reports, no writes
 *   npx tsx prisma/create-head-master.ts --login-id HM-TEST --name "Test Head Master" --apply
 *
 * Optional: --email someone@example.com   --institute BCSK   (institute code or id; default 1)
 *
 * Same rules as `UserService.create`: a generated password, `mustChangePassword` on (SEC-2),
 * and a USER_CREATE audit row written in the same transaction. No email is sent; the password
 * goes to a gitignored file, never stdout, for the same reason as rotate-passwords.ts.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";

const db = new PrismaClient();

const APPLY = process.argv.includes("--apply");

/** The value after `--flag`, or undefined. */
function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value.trim() : undefined;
}

/** 18 bytes of entropy, URL-safe, no ambiguous-looking punctuation to mis-transcribe. */
const newPassword = () => randomBytes(18).toString("base64url");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const loginId = arg("--login-id");
  const name = arg("--name");
  const email = arg("--email") ?? null;
  const instituteArg = arg("--institute") ?? "1";

  if (!loginId || !name) fail('Usage: --login-id <ID> --name "<Full name>" [--email <address>] [--institute <code|id>] [--apply]');
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(loginId)) fail("The login ID must be 3-32 letters, digits, dots, dashes or underscores.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" is not an email address.`);

  const institute = await db.institute.findFirst({
    where: /^\d+$/.test(instituteArg) ? { id: Number(instituteArg) } : { code: instituteArg },
    select: { id: true, code: true, name: true, active: true },
  });
  if (!institute) fail(`No institute matches "${instituteArg}".`);
  if (!institute.active) fail(`Institute ${institute.code} is inactive.`);

  if (await db.user.findUnique({ where: { loginId }, select: { id: true } })) {
    fail(`Login ID ${loginId} already exists. Choose another, or reset that account's password from the admin Users page.`);
  }
  const existing = await db.user.findMany({
    where: { instituteId: institute.id, role: "HEAD_MASTER" },
    select: { loginId: true, active: true },
  });

  console.log(`Institute   ${institute.code} (#${institute.id}) ${institute.name}`);
  console.log(`Login ID    ${loginId}`);
  console.log(`Name        ${name}`);
  console.log(`Email       ${email ?? "- none -"}`);
  console.log(`Role        HEAD_MASTER, password change forced at first sign-in`);
  if (existing.length) {
    console.log(`\nNote: this institute already has ${existing.length} Head Master account(s): ${existing.map((u) => `${u.loginId}${u.active ? "" : " (inactive)"}`).join(", ")}`);
  }

  if (!APPLY) {
    console.log("\nDry run - nothing was written. Re-run with --apply to create the account.");
    return;
  }

  // Hash outside the transaction: bcrypt is deliberately slow and must not hold locks.
  const password = newPassword();
  const hash = await bcrypt.hash(password, 12);

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { instituteId: institute.id, loginId, name, email, passwordHash: hash, role: "HEAD_MASTER", mustChangePassword: true },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { userId: null, action: "USER_CREATE", entity: "User", entityId: loginId, detail: "HEAD_MASTER (create-head-master script)" },
    });
    return u;
  });

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      category: "auth",
      event: "user_created",
      loginId,
      role: "HEAD_MASTER",
      by: "create-head-master script",
    }),
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = join(process.cwd(), `head-master-credentials-${stamp}.txt`);
  writeFileSync(
    outFile,
    [
      `BCSK Head Master account - ${new Date().toISOString()}`,
      `Institute ${institute.code}. Sign in at /admin; a new password is required at first sign-in.`,
      `Hand this over over a channel you trust, then delete this file.`,
      "",
      `LOGIN ID   ${loginId}`,
      `PASSWORD   ${password}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  console.log(`\nCreated user #${user.id}.`);
  console.log(`The temporary password is in: ${outFile}`);
  console.log("That file is gitignored. Sign in, set a new password, then delete it.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
