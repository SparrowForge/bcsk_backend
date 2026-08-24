import type * as Marked from "marked";

/**
 * `marked` ships ESM-only, which our CommonJS build cannot `require()` on Vercel's runtime.
 * `scripts/bundle-vendor.mjs` pre-bundles it to a self-contained CJS file at build time, so a
 * plain synchronous require is all that is needed here. See `common/sanitize-html.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { marked } = require("../vendor/marked.cjs") as typeof Marked;

export { marked };
