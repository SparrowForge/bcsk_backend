/**
 * Grading rules, free of the database so B5's result processing and the tests share them.
 *
 * A scheme is a list of bands, each holding its lower bound in percent; a band runs up to the
 * next band's bound, the top one to 100. Exactly one band starts at 0, so every percentage has
 * a grade. A failing band (`passing: false`) is a fail whatever else is true.
 */
export type Band = { minPercent: number; grade: string; gradePoint: number | null; passing: boolean; remark?: string | null };

/** The bands as entered, or the first problem with them. */
export function checkBands(bands: Band[]): string | null {
  if (bands.length < 2) return "A scheme needs at least two grades.";
  const mins = bands.map((b) => b.minPercent);
  if (mins.some((m) => !Number.isFinite(m) || m < 0 || m >= 100)) return "Each lower bound must be from 0 up to (not including) 100.";
  if (new Set(mins).size !== mins.length) return "Two grades start at the same percentage.";
  if (!mins.includes(0)) return "One grade must start at 0%, so every mark has a grade.";
  if (new Set(bands.map((b) => b.grade.trim().toUpperCase())).size !== bands.length) return "Two bands have the same grade.";
  // Higher bands must not be worth fewer points, and a failing band cannot sit above a passing one.
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i - 1]!, lo = sorted[i]!;
    if (hi.gradePoint != null && lo.gradePoint != null && hi.gradePoint < lo.gradePoint) {
      return `${hi.grade} is worth fewer points than ${lo.grade} below it.`;
    }
    if (!hi.passing && lo.passing) return `${hi.grade} fails but ${lo.grade} below it passes.`;
  }
  return null;
}

/** The band a percentage falls in. */
export function gradeFor(percent: number, bands: Band[]): Band {
  const p = Math.max(0, Math.min(100, percent));
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => p >= b.minPercent) ?? sorted[sorted.length - 1]!;
}

/** Percentage of full marks, to two decimal places. */
export const percentOf = (obtained: number, fullMarks: number) => Math.round((obtained / fullMarks) * 10_000) / 100;

/** Bangladesh GPA 5.0 - the scheme every new institute starts with, as the migration seeds it. */
export const BD_GPA_5: Band[] = [
  { minPercent: 80, grade: "A+", gradePoint: 5, passing: true, remark: "Outstanding" },
  { minPercent: 70, grade: "A", gradePoint: 4, passing: true, remark: "Excellent" },
  { minPercent: 60, grade: "A-", gradePoint: 3.5, passing: true, remark: "Very good" },
  { minPercent: 50, grade: "B", gradePoint: 3, passing: true, remark: "Good" },
  { minPercent: 40, grade: "C", gradePoint: 2, passing: true, remark: "Satisfactory" },
  { minPercent: 33, grade: "D", gradePoint: 1, passing: true, remark: "Pass" },
  { minPercent: 0, grade: "F", gradePoint: 0, passing: false, remark: "Fail" },
];
