import type SanitizeHtml from "sanitize-html";

/**
 * `sanitize-html`'s own dependency `htmlparser2` ships ESM-only (no `require` export
 * condition), the same class of bug `jose`/`marked` hit — except here it's inside a
 * dependency's dependency, so we can't fix the call site directly the way `common/jose.ts` and
 * `common/marked.ts` do.
 *
 * `scripts/bundle-vendor.mjs` pre-bundles the whole `sanitize-html` dependency graph into a
 * single self-contained CommonJS file at build time (regenerated on every `npm run build`, not
 * committed — see .gitignore), so there is no separate runtime `require()` of the ESM-only
 * package left for Vercel's runtime to choke on. `jose` and `marked` are handled the same way.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sanitizeHtml = require("../vendor/sanitize-html.cjs") as typeof SanitizeHtml;

export default sanitizeHtml;
