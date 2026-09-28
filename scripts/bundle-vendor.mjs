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
// Every `nest build` / `nest start` wipes `dist/` (deleteOutDir). nest-cli.json declares
// `src/vendor/*.cjs` as assets, so the Nest CLI copies these files back into `dist/src/vendor/`
// after that wipe — for `start` and `start:dev` (watch mode too) as well as `build`, which
// previously crashed with "Cannot find module '../vendor/jose.cjs'" because only `build` re-ran
// this script. The direct copy below is kept for `postinstall`, when `dist/` may already exist.
const distOutdir = path.join(backendRoot, "dist", "src", "vendor");

const targets = [
  {
    name: "sanitize-html",
    entry: path.join(backendRoot, "node_modules", "sanitize-html", "index.js"),
  },
  { name: "jose", entry: path.join(backendRoot, "node_modules", "jose", "dist", "webapi", "index.js") },
  { name: "marked", entry: path.join(backendRoot, "node_modules", "marked", "lib", "marked.esm.js") },
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
