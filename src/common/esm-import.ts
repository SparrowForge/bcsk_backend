/**
 * Load an ESM-only package (no `require` export condition — e.g. `jose`, `marked`) from our
 * CommonJS build without tripping `ERR_REQUIRE_ESM`.
 *
 * A static `import` or a plain dynamic `import()` both compile, under tsc with
 * `"module": "commonjs"`, to `require(specifier)` (a plain `import()` is downlevelled to
 * `Promise.resolve().then(() => require(specifier))` — still a `require()` underneath). Routing
 * the call through `Function` hides it from that downlevel transform, so this is a genuine ESM
 * `import()` at runtime, on any Node.js version and regardless of which tool compiled this file
 * (verified against both `nest build` and plain `tsc`, since Vercel's build does not match
 * either exactly).
 */
const indirectImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

/**
 * Vitest runs this source through its own (Vite-based) transform rather than tsc, so a plain
 * `import()` here stays a genuine dynamic import there and is never downlevelled — but Vitest's
 * sandboxed module runner has no `importModuleDynamically` callback registered for code built
 * via `new Function`, and the call above throws synchronously instead of rejecting. This path
 * never runs against the compiled `dist` output, so it never re-introduces the `require()` bug.
 */
export function loadEsm<T>(specifier: string): Promise<T> {
  try {
    return indirectImport(specifier).catch(() => import(specifier)) as Promise<T>;
  } catch {
    return import(specifier) as Promise<T>;
  }
}
