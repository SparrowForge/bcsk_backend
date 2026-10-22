import { gradeFor, percentOf, type Band } from "../exam/grading";

/**
 * Result processing as a pure function: from the papers of an exam, each student's marks and the
 * exam's grading scheme, compute every student's subject grades, totals, GPA or overall grade,
 * pass/fail, and their place in their section and in the whole class. Kept free of the database
 * so every rule below is unit-tested.
 *
 * Subjects. A subject is passed when the student sat it and scored at least its pass marks and
 * the band they land in is a passing one. An absence scores 0 and fails the subject.
 *
 * GPA schemes (Bangladesh style). The GPA is the average grade point of the compulsory subjects.
 * An optional subject adds only what its point exceeds 2.0, spread over the compulsory subjects,
 * and the GPA is capped at the scheme's top point. Failing any compulsory subject makes the GPA 0
 * and the overall grade the failing one. The overall grade is the band whose point is the highest
 * not above the GPA.
 *
 * Letter schemes. No GPA: the overall grade comes from the overall percentage; the student passes
 * when every compulsory subject is passed.
 *
 * Places. Passed students rank above failed ones; then by GPA (letter: percentage), then total
 * marks. With SHARED ties, students equal on all of those share a place and the next is skipped
 * (1, 1, 3); with SPLIT, ties are broken by roll number (1, 2, 3).
 */

export type PaperIn = { paperId: number; subjectName: string; fullMarks: number; passMarks: number; isOptional: boolean };
export type MarkIn = { paperId: number; obtained: number | null; isAbsent: boolean };
export type StudentIn = { studentUserId: number; sectionId: number; rollNo: number | null; marks: MarkIn[] };
export type SchemeIn = { kind: "GPA" | "LETTER" | string; bands: Band[] };

export type LineOut = {
  paperId: number; subjectName: string; fullMarks: number; passMarks: number; obtained: number | null; isAbsent: boolean;
  percent: number; grade: string; gradePoint: number | null; passed: boolean; isOptional: boolean;
};
export type SummaryOut = {
  studentUserId: number; sectionId: number; rollNo: number | null;
  totalObtained: number; totalFull: number; percent: number; gpa: number | null; grade: string;
  passed: boolean; failedSubjects: number; sectionPosition: number | null; classPosition: number | null;
  lines: LineOut[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeResults(papers: PaperIn[], students: StudentIn[], scheme: SchemeIn, ties: "SHARED" | "SPLIT" | string): SummaryOut[] {
  const failing = [...scheme.bands].filter((b) => !b.passing).sort((a, b) => a.minPercent - b.minPercent)[0]
    ?? [...scheme.bands].sort((a, b) => a.minPercent - b.minPercent)[0]!;
  const topPoint = Math.max(...scheme.bands.map((b) => b.gradePoint ?? 0));

  const summaries: SummaryOut[] = students.map((s) => {
    const byPaper = new Map(s.marks.map((m) => [m.paperId, m]));
    const lines: LineOut[] = papers.map((p) => {
      const m = byPaper.get(p.paperId);
      const isAbsent = !m || m.isAbsent || m.obtained == null;
      const obtained = isAbsent ? null : m!.obtained!;
      const percent = percentOf(obtained ?? 0, p.fullMarks);
      const band = isAbsent ? failing : gradeFor(percent, scheme.bands);
      const passed = !isAbsent && obtained! >= p.passMarks && band.passing;
      const shown = passed ? band : failing;
      return {
        paperId: p.paperId, subjectName: p.subjectName, fullMarks: p.fullMarks, passMarks: p.passMarks, obtained, isAbsent,
        percent, grade: shown.grade, gradePoint: shown.gradePoint ?? null, passed, isOptional: p.isOptional,
      };
    });

    const compulsory = lines.filter((l) => !l.isOptional);
    const optional = lines.filter((l) => l.isOptional);
    const failedSubjects = compulsory.filter((l) => !l.passed).length;
    const passed = compulsory.length > 0 && failedSubjects === 0;
    const totalObtained = round2(lines.reduce((t, l) => t + (l.obtained ?? 0), 0));
    const totalFull = lines.reduce((t, l) => t + l.fullMarks, 0);
    const percent = totalFull === 0 ? 0 : percentOf(totalObtained, totalFull);

    let gpa: number | null = null;
    let grade: string;
    if (scheme.kind === "GPA") {
      if (!passed) {
        gpa = 0;
        grade = failing.grade;
      } else {
        const base = compulsory.reduce((t, l) => t + (l.gradePoint ?? 0), 0);
        const bonus = optional.filter((l) => l.passed).reduce((t, l) => t + Math.max(0, (l.gradePoint ?? 0) - 2), 0);
        gpa = round2(Math.min(topPoint, (base + bonus) / compulsory.length));
        const byPoint = [...scheme.bands].filter((b) => b.gradePoint != null && b.gradePoint <= gpa!).sort((a, b) => b.gradePoint! - a.gradePoint!);
        grade = (byPoint[0] ?? failing).grade;
      }
    } else {
      grade = passed ? gradeFor(percent, scheme.bands).grade : failing.grade;
    }
    return {
      studentUserId: s.studentUserId, sectionId: s.sectionId, rollNo: s.rollNo,
      totalObtained, totalFull, percent, gpa, grade, passed, failedSubjects,
      sectionPosition: null, classPosition: null, lines,
    };
  });

  const ranked = (group: SummaryOut[]) => {
    const key = (r: SummaryOut) => [r.passed ? 1 : 0, scheme.kind === "GPA" ? r.gpa ?? 0 : r.percent, r.totalObtained] as const;
    const sorted = [...group].sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
      return (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || a.studentUserId - b.studentUserId;
    });
    const places = new Map<number, number>();
    sorted.forEach((r, i) => {
      if (ties === "SHARED" && i > 0) {
        const prev = sorted[i - 1]!;
        if (key(prev).every((v, j) => v === key(r)[j])) {
          places.set(r.studentUserId, places.get(prev.studentUserId)!);
          return;
        }
      }
      places.set(r.studentUserId, i + 1);
    });
    return places;
  };

  const classPlaces = ranked(summaries);
  const bySection = new Map<number, SummaryOut[]>();
  for (const s of summaries) bySection.set(s.sectionId, [...(bySection.get(s.sectionId) ?? []), s]);
  const sectionPlaces = new Map<number, number>();
  for (const group of bySection.values()) for (const [id, p] of ranked(group)) sectionPlaces.set(id, p);

  return summaries.map((s) => ({ ...s, sectionPosition: sectionPlaces.get(s.studentUserId)!, classPosition: classPlaces.get(s.studentUserId)! }));
}
