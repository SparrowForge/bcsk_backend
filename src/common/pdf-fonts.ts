import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Fonts for scripts pdfkit's built-in Helvetica cannot draw (LMS B7).
 *
 * Bengali and Korean text needs an embedded font. The files live in `backend/assets/fonts/`
 * under the names below (Noto Sans, SIL Open Font Licence 1.1 - the licence texts sit beside
 * them), and on Vercel that folder must be listed in `vercel.json` `includeFiles`, or the file
 * tracer leaves it out. Until a script's font is present, documents containing that script are
 * refused before drawing (see `assertPrintable`) rather than printed as empty boxes.
 *
 * Ranges are written as escapes on purpose: some of these characters are invisible or look like
 * a plain space, and a literal one in a character class is easy to break unseen.
 */
const BENGALI = "\\u0980-\\u09FF\\u0964\\u0965"; // the Bengali block, plus the danda and double danda Bengali ends sentences with
const HANGUL = "\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF";

export const SCRIPT_FONTS = {
  bengali: { file: "NotoSansBengali-Regular.ttf", test: new RegExp(`[${BENGALI}]`) },
  // The Noto CJK project ships its static Korean font as OpenType (CFF), not TrueType.
  korean: { file: "NotoSansKR-Regular.otf", test: new RegExp(`[${HANGUL}]`) },
} as const;
export type Script = keyof typeof SCRIPT_FONTS;

const FONT_DIR = join(process.cwd(), "assets", "fonts");

/** The path of a script's font file, or null when it is not installed. */
export function fontPath(script: Script, dir = FONT_DIR): string | null {
  const p = join(dir, SCRIPT_FONTS[script].file);
  return existsSync(p) ? p : null;
}

/** The non-Latin scripts a piece of text uses. */
export function scriptsIn(text: string): Script[] {
  return (Object.keys(SCRIPT_FONTS) as Script[]).filter((s) => SCRIPT_FONTS[s].test.test(text));
}

/** Characters no available font can draw: anything outside Latin, punctuation, Bengali, Hangul. */
export const UNSUPPORTED = new RegExp(`[^\\u0000-\\u024F\\u2000-\\u206F\\u20AC${BENGALI}${HANGUL}]`);

/**
 * Split text into runs that one font can draw. Noto Sans Bengali has no Latin letters, digits or
 * commas, so a Bengali sentence holding "BCSK-2026-0001" must switch fonts mid-line. Spaces and
 * the zero-width joiners stay with the run they sit in, so a word never splits from its joiner.
 */
export function bengaliRuns(text: string): { text: string; bengali: boolean }[] {
  const isBengali = SCRIPT_FONTS.bengali.test;
  const neutral = /[\s‌‍]/;
  const runs: { text: string; bengali: boolean }[] = [];
  for (const ch of text) {
    const last = runs[runs.length - 1];
    const bengali = neutral.test(ch) && last ? last.bengali : isBengali.test(ch);
    if (last && last.bengali === bengali) last.text += ch;
    else runs.push({ text: ch, bengali });
  }
  return runs;
}

type Piece = { text: string; font: string; width: number };

/**
 * Write a block of text that may mix Bengali with Latin. pdfkit's own `continued` text overlaps
 * runs of different fonts once a line is centred, so mixed text is laid out here instead: each
 * word is measured run by run in its own font, words are wrapped greedily into the width, and
 * each run is drawn at its exact position. Shaping still happens inside each run, so Bengali
 * conjuncts are formed as usual. Text with no Bengali is written in one go with `fontFor`.
 */
export function writeMixed(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: { width?: number; align?: "left" | "center" | "right"; lineGap?: number },
  bold = false,
): PDFKit.PDFDocument {
  const bengaliFont = fontPath("bengali");
  if (!bengaliFont || !SCRIPT_FONTS.bengali.test.test(text)) return fontFor(doc, text, bold).text(text, x, y, options);

  const latin = bold ? "Helvetica-Bold" : "Helvetica";
  const measure = (t: string, font: string) => doc.font(font).widthOfString(t);
  const words = text.split(/ +/).filter(Boolean).map((word) => {
    const pieces: Piece[] = bengaliRuns(word).map((r) => {
      const font = r.bengali ? bengaliFont : (fontPath("korean") && SCRIPT_FONTS.korean.test.test(r.text) ? fontPath("korean")! : latin);
      return { text: r.text, font, width: measure(r.text, font) };
    });
    return { pieces, width: pieces.reduce((w, p) => w + p.width, 0) };
  });
  const space = measure(" ", latin);
  const maxWidth = options.width ?? doc.page.width - x - doc.page.margins.right;

  const lines: (typeof words)[] = [];
  let line: typeof words = [];
  let lineWidth = 0;
  for (const w of words) {
    const extra = line.length ? space + w.width : w.width;
    if (line.length && lineWidth + extra > maxWidth) {
      lines.push(line);
      line = [w];
      lineWidth = w.width;
    } else {
      line.push(w);
      lineWidth += extra;
    }
  }
  if (line.length) lines.push(line);

  // Bengali sits taller than Latin at the same size; take the taller line height.
  const height = Math.max(doc.font(latin).currentLineHeight(true), doc.font(bengaliFont).currentLineHeight(true)) + (options.lineGap ?? 0);
  lines.forEach((ws, i) => {
    const width = ws.reduce((t, w) => t + w.width, 0) + space * (ws.length - 1);
    let cx = options.align === "center" ? x + (maxWidth - width) / 2 : options.align === "right" ? x + maxWidth - width : x;
    for (const [j, w] of ws.entries()) {
      if (j > 0) cx += space;
      for (const p of w.pieces) {
        doc.font(p.font).text(p.text, cx, y + i * height, { lineBreak: false });
        cx += p.width;
      }
    }
  });
  doc.x = x;
  doc.y = y + lines.length * height;
  return doc;
}

/**
 * Choose the font for a run of text: the script font when the text needs one (and it is
 * installed), else Helvetica. The script fonts have no bold face, so bold falls back to regular.
 */
export function fontFor(doc: PDFKit.PDFDocument, text: string, bold = false): PDFKit.PDFDocument {
  const [script] = scriptsIn(text);
  if (script) {
    const p = fontPath(script);
    if (p) return doc.font(p);
  }
  return doc.font(bold ? "Helvetica-Bold" : "Helvetica");
}
