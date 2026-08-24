// Pre-bundles npm packages whose dependency tree contains an ESM-only package (no CJS
// `require` export condition) into a single self-contained CommonJS file each.
//
// Node's own `require(esm)` support (stable since Node 22.12) hides this class of problem on a
// dev machine, but Vercel's serverless Node.js runtime does not implement it, so any package
// that (even transitively) ships ESM-only crashes every request with ERR_REQUIRE_ESM the moment
// it's required. Bundling resolves and inlines the whole dependency graph at build time, so
// there is no separate runtime `require()` of the offending package left for Vercel to choke on
// — this fixes the bug class once, rather than one transitive dependency at a time.
//
// Regenerated on every `npm run build`; output is not committed (see .gitignore).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const backendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcOutdir = path.join(backendRoot, "src", "vendor");
// `nest build` wipes and recreates `dist/` on every run (deleteOutDir), and only copies
// compiled `.ts` output there — a plain `.cjs` file placed here is never carried over on its
// own. So this script also copies straight into `dist/src/vendor/`, and `npm run build` runs it
// again *after* `nest build` to survive that wipe (see package.json).
const distOutdir = path.join(backendRoot, "dist", "src", "vendor");

const targets = [
  {
    name: "sanitize-html",
    entry: path.join(backendRoot, "node_modules", "sanitize-html", "index.js"),
  },
];

for (const t of targets) {
  const outfile = path.join(srcOutdir, `${t.name}.cjs`);
  await build({
    entryPoints: [t.entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile,
    logLevel: "info",
  });
  console.log(`bundled ${t.name} -> src/vendor/${t.name}.cjs`);

  if (fs.existsSync(path.join(backendRoot, "dist"))) {
    fs.mkdirSync(distOutdir, { recursive: true });
    fs.copyFileSync(outfile, path.join(distOutdir, `${t.name}.cjs`));
    console.log(`copied ${t.name} -> dist/src/vendor/${t.name}.cjs`);
  }
}
