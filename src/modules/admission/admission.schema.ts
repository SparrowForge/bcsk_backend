import { z } from "zod";

/**
 * Validation lives beside the service, so the HTTP controller and any other caller share
 * one definition. There is no second copy in the frontend to drift from.
 */
const shared = {
  applicantName: z.string().trim().min(2).max(120),
  dob: z.string().min(4),
  gender: z.string().min(1),
  religion: z.string().min(1),
  phone: z.string().min(5).max(40),
  email: z.string().email(),
  addressBangladesh: z.string().min(2).max(400),
  emergencyContact: z.string().min(5).max(120),
  parentalConsent: z.literal(true, { message: "Parental consent is required (PIPA)." }),
  photoPath: z.string().min(1, "A photo is required."),
  recaptchaToken: z.string().optional(),
  /** GAP-11: the specification asks for this and the old form omitted it. */
  learningMode: z.enum(["online", "hybrid"]).optional(),
  idDocumentPath: z.string().optional(),
};

export const regularApplicationSchema = z.object({
  ...shared,
  grade: z.string().min(1),
  fatherName: z.string().trim().min(2).max(120),
  motherName: z.string().trim().min(2).max(120),
  guardianProfession: z.string().max(120).optional(),
  guardianEducation: z.string().max(120).optional(),
  guardianPhone2: z.string().max(40).optional(),
  addressKorea: z.string().min(2).max(400),
});

export const specialApplicationSchema = z.object({
  ...shared,
  courseName: z.string().min(1),
  highestEducation: z.string().max(200).optional(),
  addressKorea: z.string().max(400).optional(),
  isBcskStudent: z.boolean().default(false),
});

export type RegularApplicationInput = z.infer<typeof regularApplicationSchema>;
export type SpecialApplicationInput = z.infer<typeof specialApplicationSchema>;
