import type * as Jose from "jose";
import { loadEsm } from "./esm-import";

let josePromise: Promise<typeof Jose> | undefined;

export function getJose(): Promise<typeof Jose> {
  josePromise ??= loadEsm<typeof Jose>("jose");
  return josePromise;
}
