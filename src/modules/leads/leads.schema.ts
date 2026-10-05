import { z } from "zod";

/**
 * CRM validation, beside the service so the controller and any other caller share one
 * definition. Stages, outcomes and lost-reasons are strings in the database (like every other
 * status column here) and are constrained only in this file.
 */

export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "APPLIED", "ADMITTED", "ENROLLED", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Ordered open stages. ENROLLED and LOST are terminal. */
export const OPEN_STAGES: readonly LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "APPLIED", "ADMITTED"];
export const TERMINAL_STAGES: readonly LeadStage[] = ["ENROLLED", "LOST"];

export const ACTIVITY_TYPES = [
  "CALL", "EMAIL", "SMS", "WHATSAPP", "MEETING", "CAMPUS_VISIT", "NOTE", "STAGE_CHANGE", "ASSIGNMENT",
] as const;
/** Types a counsellor may log by hand; STAGE_CHANGE and ASSIGNMENT are written by the system. */
export const MANUAL_ACTIVITY_TYPES = ["CALL", "EMAIL", "SMS", "WHATSAPP", "MEETING", "CAMPUS_VISIT", "NOTE"] as const;
export const ACTIVITY_OUTCOMES = [
  "REACHED", "NO_ANSWER", "CALLBACK_REQUESTED", "NOT_INTERESTED", "INFORMATION_SENT", "COMPLETED",
] as const;
export const LOST_REASONS = [
  "NOT_INTERESTED", "CHOSE_COMPETITOR", "FEES_TOO_HIGH", "NOT_ELIGIBLE", "COURSE_UNAVAILABLE",
  "UNREACHABLE", "DUPLICATE", "OTHER",
] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optDate = z.string().optional().nullable().refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "Invalid date");
const optId = z.coerce.number().int().positive().optional().nullable();

const leadFields = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  phone: optText(40),
  alternatePhone: optText(40),
  gender: optText(20),
  city: optText(100),
  sourceId: optId,
  campaign: optText(150),
  referredBy: optText(150),
  courseId: optId,
  remarks: optText(5000),
  nextFollowUpAt: optDate,
};

export const createLeadSchema = z
  .object({ ...leadFields, stage: z.enum(LEAD_STAGES).optional(), assignedToUserId: optId })
  .refine((v) => v.email || v.phone, { message: "Give an email or a phone number.", path: ["phone"] });

export const updateLeadSchema = z.object(leadFields).partial();

export const listLeadsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  sourceId: z.coerce.number().int().optional(),
  courseId: z.coerce.number().int().optional(),
  assignedToUserId: z.coerce.number().int().optional(),
  unassigned: z.enum(["1", "true"]).optional(),
  followUpDue: z.enum(["1", "true"]).optional(),
  search: z.string().trim().max(100).optional(),
});

export const stageSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  lostReason: z.enum(LOST_REASONS).optional(),
  lostNote: optText(2000),
  note: optText(2000),
  nextFollowUpAt: optDate,
});

export const assignSchema = z.object({
  assignedToUserId: z.coerce.number().int().positive().nullable(),
  nextFollowUpAt: optDate,
  note: optText(2000),
});

export const bulkAssignSchema = z.object({
  leadIds: z.array(z.coerce.number().int().positive()).min(1).max(200),
  assignedToUserId: z.coerce.number().int().positive().nullable(),
});

export const convertSchema = z.object({
  /** Which kind of application to prefill. Defaults from the lead's course. */
  type: z.enum(["REGULAR", "SPECIAL"]).optional(),
  courseLevelId: optId,
  note: optText(2000),
});

export const activitySchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  subject: z.string().trim().min(1).max(200),
  notes: optText(5000),
  outcome: z.enum(ACTIVITY_OUTCOMES).optional().nullable(),
  scheduledAt: optDate,
  completedAt: optDate,
  nextFollowUpAt: optDate,
});

export const activityUpdateSchema = activitySchema.omit({ nextFollowUpAt: true }).partial();

export const sourceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: optText(20),
  description: optText(1000),
  isPublic: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const funnelQuery = z.object({
  courseId: z.coerce.number().int().optional(),
  from: optDate,
  to: optDate,
});

/** Web-to-lead. No stage, owner or arbitrary source: anonymous callers do not choose those. */
export const publicEnquirySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200).optional().or(z.literal("")),
    phone: optText(40),
    city: optText(100),
    courseId: optId,
    sourceId: optId,
    message: optText(3000),
    recaptchaToken: z.string().optional(),
  })
  .refine((v) => v.email || v.phone, { message: "Give an email or a phone number.", path: ["phone"] });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
