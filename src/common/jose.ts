import type * as Jose from "jose";

/**
 * `jose` ships ESM-only, which our CommonJS build cannot `require()` on Vercel's runtime.
 * `scripts/bundle-vendor.mjs` pre-bundles it to a self-contained CJS file at build time, so a
 * plain synchronous require is all that is needed here. See `common/sanitize-html.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jose = require("../vendor/jose.cjs") as typeof Jose;

export const { SignJWT, jwtVerify } = jose;
