import { z } from "zod";

/**
 * Validation lives beside the service, so the HTTP controller and any other caller share
 * one definition. There is no second copy in the frontend to drift from.
 *
 * Every registration - regular, special or re-admission - is the same form with a different
 * "what are you registering for" section, and is stored in the one ApplicationForm table.
 */
const common = {
  applicantName: z.string().trim().min(2).max(120),
  dob: z.string().min(4),
  gender: z.string().min(1),
  religion: z.string().min(1),
  phone: z.string().min(5).max(40),
  email: z.string().email(),
  addressBangladesh: z.string().min(2).max(400),
  addressKorea: z.string().max(400).optional(),
  emergencyContact: z.string().min(5).max(120),
  parentalConsent: z.literal(true, { message: "Parental consent is required (PIPA)." }),
  photoPath: z.string().optional(),
  recaptchaToken: z.string().optional(),
  /** GAP-11: the specification asks for this and the old form omitted it. */
  learningMode: z.enum(["online", "hybrid"]).optional(),
  idDocumentPath: z.string().optional(),
};

const guardian = {
  fatherName: z.string().trim().min(2).max(120),
  motherName: z.string().trim().min(2).max(120),
  guardianProfession: z.string().max(120).optional(),
  guardianEducation: z.string().max(120).optional(),
  guardianPhone2: z.string().max(40).optional(),
};

/**
 * A class is chosen by `courseLevelId` - a level of the Regular Course. `grade` (PRE_PRIMARY,
 * CLASS_1…) is still accepted for older callers; the service needs one of the two.
 */
const classChoice = {
  courseLevelId: z.coerce.number().int().positive().optional(),
  grade: z.string().optional(),
};

const regular = z.object({
  ...common,
  ...guardian,
  ...classChoice,
  type: z.literal("REGULAR"),
  photoPath: z.string().min(1, "A photo is required."),
  addressKorea: z.string().min(2).max(400),
});

const special = z.object({
  ...common,
  type: z.literal("SPECIAL"),
  courseName: z.string().min(1),
  /** The level or track within the course. Required when the course has levels. */
  courseLevelId: z.coerce.number().int().positive().optional(),
  highestEducation: z.string().max(200).optional(),
  isBcskStudent: z.boolean().default(false),
  photoPath: z.string().min(1, "A photo is required."),
});

const reAdmission = z.object({
  ...common,
  type: z.literal("RE_ADMISSION"),
  /** The returning student's existing BCSK ID; checked against the student records. */
  studentId: z.string().trim().min(3).max(40),
  ...classChoice,
  fatherName: guardian.fatherName.optional(),
  motherName: guardian.motherName.optional(),
});

export const applicationSchema = z.discriminatedUnion("type", [regular, special, reAdmission]);

export type ApplicationInput = z.infer<typeof applicationSchema>;
export type ApplicationType = ApplicationInput["type"];

/** What the form asks the server to price. Display only - the charge is recomputed at payment. */
export const feePreviewSchema = z.object({
  type: z.enum(["REGULAR", "SPECIAL", "RE_ADMISSION"]),
  grade: z.string().optional(),
  courseName: z.string().optional(),
  /** The chosen class (regular, re-admission) or level (special). */
  courseLevelId: z.coerce.number().int().positive().optional(),
});
