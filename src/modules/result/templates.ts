import { unprocessable } from "../../common/errors/app-error";
import { fontPath, scriptsIn, UNSUPPORTED, type Script } from "../../common/pdf-fonts";

/** Documents the Head Master issues from a template, and the placeholders their wording may use. */
export const TEMPLATE_TYPES = ["COMPLETION", "CHARACTER", "ENROLLMENT", "TRANSFER_LETTER", "MARK_SHEET"] as const;
export const PLACEHOLDERS = ["name", "studentId", "class", "section", "term", "institute", "date", "gpa", "grade", "resultLine", "destination", "reason", "effectiveDate"] as const;
export type TemplateValues = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

/**
 * Fill a template's placeholders. An unknown placeholder is left visible rather than silently
 * dropped, so a typo in the wording shows up on the proof rather than as a missing word.
 */
export function renderTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? values[key as keyof TemplateValues] ?? "" : whole,
  );
}

/** Placeholders a template uses that are not supported - for the editor to warn about. */
export function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
}

/**
 * Refuse a document no installed font can draw, before any of it is drawn, rather than print
 * empty boxes. Bengali and Korean print once their font files are in place (`pdf-fonts.ts`).
 */
export function assertPrintable(lang: string, ...texts: string[]): void {
  const needed = new Set<Script>([
    ...(lang === "bn" ? (["bengali"] as Script[]) : []),
    ...(lang === "ko" ? (["korean"] as Script[]) : []),
    ...texts.flatMap((t) => scriptsIn(t)),
  ]);
  const missing = [...needed].filter((s) => !fontPath(s));
  if (missing.length > 0) {
    throw unprocessable(`Printing ${missing.map((s) => (s === "bengali" ? "Bengali" : "Korean")).join(" and ")} needs its font, which is not installed yet. Print the English version for now.`);
  }
  if (texts.some((t) => UNSUPPORTED.test(t))) throw unprocessable("This document contains characters the school's fonts cannot print.");
}
