import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optId = z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null);
/** A short upper-case key: GEN, BAN, MATH-1. */
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Letters, numbers, dashes and underscores only.");
const order = z.coerce.number().int().min(0).max(9999).default(100);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

export const SUBJECT_TYPES = ["THEORY", "PRACTICAL"] as const;
export const ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "TRANSFERRED", "LEFT"] as const;

export const instituteSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  nameBn: optText(120),
  nameKo: optText(120),
  address: optText(300),
  phone: optText(40),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("").transform(() => null)).transform((v) => v || null),
  website: z.string().trim().url().max(200).optional().nullable().or(z.literal("").transform(() => null)).transform((v) => v || null),
  logoUrl: optText(300),
  headMasterName: optText(120),
  signatureUrl: optText(300),
  active: z.boolean().default(true),
});
/** The institute's own profile: everything but the code, which other records key on. */
export const instituteProfileSchema = instituteSchema.omit({ code: true, active: true });

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code,
  headUserId: optId,
  displayOrder: order,
  active: z.boolean().default(true),
});

export const termSchema = z
  .object({
    code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only, like 2026-2."),
    name: z.string().trim().min(1).max(80),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((t) => !t.startDate || !t.endDate || t.startDate <= t.endDate, {
    message: "The term must end after it starts.",
    path: ["endDate"],
  });

export const batchSchema = z.object({
  courseLevelId: z.coerce.number().int().positive(),
  termId: z.coerce.number().int().positive(),
  name: optText(80),
});

export const sectionSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(20),
  capacity: z.coerce.number().int().min(1).max(500).optional().nullable().transform((v) => v ?? null),
  room: optText(60),
  classTeacherId: optId,
  active: z.boolean().default(true),
});
export const sectionUpdateSchema = sectionSchema.omit({ batchId: true });

export const subjectSchema = z.object({
  code,
  name: z.string().trim().min(1).max(80),
  departmentId: optId,
  type: z.enum(SUBJECT_TYPES).default("THEORY"),
  displayOrder: order,
  active: z.boolean().default(true),
});

export const curriculumSchema = z
  .object({
    fullMarks: z.coerce.number().int().min(1).max(1000).default(100),
    passMarks: z.coerce.number().int().min(0).max(1000).default(33),
    isOptional: z.boolean().default(false),
    displayOrder: order,
  })
  .refine((c) => c.passMarks <= c.fullMarks, { message: "Pass marks cannot exceed full marks.", path: ["passMarks"] });

export const placeStudentSchema = z.object({
  studentUserId: z.coerce.number().int().positive(),
  rollNo: z.coerce.number().int().min(1).max(9999).optional().nullable().transform((v) => v ?? null),
});
export const enrollmentUpdateSchema = z.object({
  rollNo: z.coerce.number().int().min(1).max(9999).optional().nullable(),
  status: z.enum(ENROLLMENT_STATUSES).optional(),
});

export const teacherAssignmentSchema = z.object({
  teacherProfileId: z.coerce.number().int().positive(),
  subjectId: z.coerce.number().int().positive(),
});

export const courseDepartmentSchema = z.object({ departmentId: optId });

export const sectionFilter = z.object({
  termId: z.coerce.number().int().positive().optional(),
  courseLevelId: z.coerce.number().int().positive().optional(),
});
export const studentFilter = z.object({
  q: z.string().trim().max(80).optional(),
  unplacedInTermId: z.coerce.number().int().positive().optional(),
});

export type InstituteInput = z.infer<typeof instituteSchema>;
export type InstituteProfileInput = z.infer<typeof instituteProfileSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type TermInput = z.infer<typeof termSchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type SectionInput = z.infer<typeof sectionSchema>;
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type SubjectInput = z.infer<typeof subjectSchema>;
export type CurriculumInput = z.infer<typeof curriculumSchema>;
export type EnrollmentUpdateInput = z.infer<typeof enrollmentUpdateSchema>;
