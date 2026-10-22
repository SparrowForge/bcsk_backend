import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Not a real date.");

export const leaveSchema = z
  .object({
    fromDate: day,
    toDate: day,
    reason: z.string().trim().min(5, "Say briefly why.").max(1000),
    attachmentUrl: z
      .string()
      .trim()
      .regex(/^leave\/[a-f0-9]{16}\.(pdf|jpg|png|webp)$/, "Upload the note first; use the path the upload returned.")
      .optional()
      .nullable()
      .transform((v) => v || null),
  })
  .refine((l) => l.toDate >= l.fromDate, { message: "Leave must end on or after its first day.", path: ["toDate"] });

export const reviewSchema = z.object({ recommendation: z.enum(["APPROVE", "REJECT"]), note: optText(500) });
export const decisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: optText(500) })
  .refine((d) => d.decision === "APPROVE" || !!d.note, { message: "Give the student a reason for a rejection.", path: ["note"] });

export const transferSchema = z.object({
  destination: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(5, "Say briefly why.").max(1000),
  effectiveDate: day,
});
export const clearanceSchema = z.object({ duesCleared: z.boolean(), libraryCleared: z.boolean(), note: optText(500) });

export const statusFilter = z.object({ status: z.string().trim().toUpperCase().regex(/^[A-Z]+$/).optional() });
export const leaveSettingsSchema = z.object({ leaveTeacherMaxDays: z.coerce.number().int().min(0).max(30) });

export type LeaveInput = z.infer<typeof leaveSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
