import { z } from "zod";
import { checkBands } from "./grading";
import { toMinutes } from "../schedule/schedule.schema";

export const EXAM_TYPES = ["CLASS_TEST", "MIDTERM", "TERM", "FINAL", "MODEL"] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optId = z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null);
const clock = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, like 10:00.");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Not a real date.");

const band = z.object({
  minPercent: z.coerce.number().min(0).max(99.99),
  grade: z.string().trim().min(1).max(8),
  gradePoint: z.coerce.number().min(0).max(10).optional().nullable().transform((v) => v ?? null),
  passing: z.boolean().default(true),
  remark: optText(60),
});

export const schemeSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(["GPA", "LETTER"]).default("GPA"),
    isDefault: z.boolean().default(false),
    active: z.boolean().default(true),
    bands: z.array(band).min(2).max(20),
  })
  .superRefine((s, ctx) => {
    const problem = checkBands(s.bands);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["bands"] });
    if (s.kind === "GPA" && s.bands.some((b) => b.gradePoint == null)) {
      ctx.addIssue({ code: "custom", message: "Every grade of a GPA scheme needs its grade point.", path: ["bands"] });
    }
  });

export const examSchema = z.object({
  termId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  type: z.enum(EXAM_TYPES).default("TERM"),
  gradingSchemeId: optId,
  instructions: optText(2000),
});
export const examUpdateSchema = examSchema.omit({ termId: true });

const paperTimes = <T extends { startTime: string; endTime: string }>(p: T) => toMinutes(p.endTime) > toMinutes(p.startTime);
const marksFit = <T extends { fullMarks?: number | null; passMarks?: number | null }>(p: T) =>
  p.fullMarks == null || p.passMarks == null || p.passMarks <= p.fullMarks;

export const paperSchema = z
  .object({
    courseLevelId: z.coerce.number().int().positive(),
    subjectId: z.coerce.number().int().positive(),
    date: day,
    startTime: clock,
    endTime: clock,
    room: optText(60),
    // Taken from the class's curriculum when left out.
    fullMarks: z.coerce.number().int().min(1).max(1000).optional().nullable(),
    passMarks: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    examinerId: optId,
  })
  .refine(paperTimes, { message: "A paper must end after it starts.", path: ["endTime"] })
  .refine(marksFit, { message: "Pass marks cannot exceed full marks.", path: ["passMarks"] });

export const paperUpdateSchema = z
  .object({
    date: day,
    startTime: clock,
    endTime: clock,
    room: optText(60),
    fullMarks: z.coerce.number().int().min(1).max(1000),
    passMarks: z.coerce.number().int().min(0).max(1000),
    examinerId: optId,
  })
  .refine(paperTimes, { message: "A paper must end after it starts.", path: ["endTime"] })
  .refine(marksFit, { message: "Pass marks cannot exceed full marks.", path: ["passMarks"] });

/** One student's mark: a number, or absent. Half marks are allowed; finer is not. */
export const marksSchema = z.object({
  entries: z
    .array(
      z.object({
        studentUserId: z.coerce.number().int().positive(),
        obtained: z.coerce.number().min(0).max(1000).multipleOf(0.5, "Marks go in halves at the finest.").optional().nullable(),
        isAbsent: z.boolean().default(false),
      }),
    )
    .max(300),
});

export const reopenSchema = z.object({ reason: z.string().trim().min(5, "Say why the marks are being reopened.").max(500) });
export const examFilter = z.object({ termId: z.coerce.number().int().positive().optional() });

export type SchemeInput = z.infer<typeof schemeSchema>;
export type ExamInput = z.infer<typeof examSchema>;
export type ExamUpdateInput = z.infer<typeof examUpdateSchema>;
export type PaperInput = z.infer<typeof paperSchema>;
export type PaperUpdateInput = z.infer<typeof paperUpdateSchema>;
export type MarkEntry = z.infer<typeof marksSchema>["entries"][number];
