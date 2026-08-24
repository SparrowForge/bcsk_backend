import type * as Jose from "jose";

/**
 * `jose` ships ESM-only (no `require` export condition), so a static `import` compiles to a
 * `require("jose")` under our CommonJS build and crashes with `ERR_REQUIRE_ESM` on any Node
 * runtime that doesn't support synchronously requiring an ES module — Vercel's Node.js
 * Serverless Functions included, even on Node 22.x.
 *
 * A plain `import("jose")` does NOT fix this: with `"module": "commonjs"` in tsconfig, tsc
 * downlevels a dynamic import to `Promise.resolve().then(() => require("jose"))`, which still
 * calls `require()` under the hood and fails the same way. Routing the call through `Function`
 * hides it from tsc's downlevel transform, so this is a genuine ESM `import()` at runtime.
 * Caching the promise means the module is only loaded once per process.
 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<typeof Jose>;

/**
 * Vitest runs this source through its own (Vite-based) transform rather than tsc, so a plain
 * `import()` here stays a genuine dynamic import there and is never downlevelled — but Vitest's
 * sandboxed module runner has no `importModuleDynamically` callback registered for code built
 * via `new Function`, and the call above throws synchronously instead of rejecting. This path
 * never runs against the compiled `dist` output, so it never re-introduces the `require()` bug.
 */
function loadJose(): Promise<typeof Jose> {
  try {
    return dynamicImport("jose").catch(() => import("jose"));
  } catch {
    return import("jose");
  }
}

let josePromise: Promise<typeof Jose> | undefined;

export function getJose(): Promise<typeof Jose> {
  josePromise ??= loadJose();
  return josePromise;
}
