/**
 * One-off content fix (17 Oct 2026): the school dropped ", Korea" from its name in every
 * language. Code and seed content were changed; this rewrites the admin-authored CMS pages
 * already in the database.
 *
 *   npx tsx prisma/rename-school-in-cms.ts                       # dry run — report only
 *   npx tsx prisma/rename-school-in-cms.ts --apply <backup.json>  # write, after saving originals
 *
 * Only the forms *with* the comma are replaced, plus the Korean name. The bank account holder
 * ("Bangladesh Community School Korea", no comma) must keep matching the bank, so it is left
 * alone wherever a page quotes it. In Korean the particle after the name follows the last
 * syllable, so "…스쿨 코리아는" becomes "…스쿨은", not "…스쿨는".
 *
 * Every row it changes is written to the backup file first; restoring is putting `content` and
 * `title` back from it.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const backupPath = process.argv[process.argv.indexOf("--apply") + 1];

/** 코리아 ends in a vowel, 스쿨 in ㄹ: the particles that change form with it. */
const KO_PARTICLE: Record<string, string> = { "는": "은", "가": "이", "를": "을", "와": "과", "로": "으로" };

export function rename(text: string): string {
  return text
    .replace(/Bangladesh Community School, Korea/g, "Bangladesh Community School")
    .replace(/বাংলাদেশ কমিউনিটি স্কুল, কোরিয়া/g, "বাংলাদেশ কমিউনিটি স্কুল")
    .replace(/방글라데시 커뮤니티 스쿨 코리아(는|가|를|와|로)?/g, (_m, p?: string) =>
      "방글라데시 커뮤니티 스쿨" + (p ? KO_PARTICLE[p] : ""),
    );
}

async function main() {
  if (APPLY && (!backupPath || backupPath.startsWith("--"))) throw new Error("--apply needs a backup file path after it.");

  const pages = await db.contentPage.findMany({
    select: { id: true, slug: true, lang: true, title: true, content: true },
    orderBy: [{ slug: "asc" }, { lang: "asc" }],
  });
  const changes = pages
    .map((p) => ({ ...p, newTitle: rename(p.title), newContent: rename(p.content) }))
    .filter((p) => p.newTitle !== p.title || p.newContent !== p.content);

  for (const c of changes) {
    const at = c.content.search(/School, Korea|স্কুল, কোরিয়া|스쿨 코리아/);
    const near = at < 0 ? "(title only)" : c.content.slice(Math.max(0, at - 30), at + 40).replace(/\s+/g, " ");
    console.log(`${c.slug} [${c.lang}] #${c.id}: …${near}…`);
  }
  console.log(`\n${changes.length} of ${pages.length} pages ${APPLY ? "to update" : "would change (dry run)"}.`);
  if (!APPLY || changes.length === 0) return;

  writeFileSync(
    backupPath,
    JSON.stringify(changes.map(({ id, slug, lang, title, content }) => ({ id, slug, lang, title, content })), null, 2),
  );
  console.log(`Originals saved to ${backupPath}`);

  // `updatedAt` moves with the write, which is what the admin list shows as "last edited".
  await db.$transaction(
    changes.map((c) => db.contentPage.update({ where: { id: c.id }, data: { title: c.newTitle, content: c.newContent } })),
  );
  console.log("Updated.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
