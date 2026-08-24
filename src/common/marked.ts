import type * as Marked from "marked";
import { loadEsm } from "./esm-import";

let markedPromise: Promise<typeof Marked> | undefined;

export function getMarked(): Promise<typeof Marked> {
  markedPromise ??= loadEsm<typeof Marked>("marked");
  return markedPromise;
}
