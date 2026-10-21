import { z } from "zod";

export const CLASS_COLORS = ["green", "blue", "purple", "orange", "teal", "red", "indigo"] as const;
export const SUBJECT_COLORS = ["pink", "purple", "blue", "teal", "green", "yellow", "orange", "red", "indigo"] as const;
export const SUBJECT_CATEGORIES = ["MAIN", "RELATED", "HOMEWORK"] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

/**
 * An image is a path the site itself serves: an upload (`/api/files/...`) or a bundled
 * placeholder (`/images/...`). Never an arbitrary URL - the page renders it as an <img>.
 */
const imageUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/(api\/files|images)\/[A-Za-z0-9/_.-]+$/, "Upload an image instead of typing a URL.")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);

/** One item per line in the admin form; blank lines dropped. */
const lines = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().max(maxLen))
    .max(maxItems)
    .default([])
    .transform((items) => items.filter(Boolean));

export const academicClassSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and single dashes only."),
  name: z.string().trim().min(2).max(60),
  ageRange: optText(40),
  summary: optText(400),
  tagline: optText(160),
  intro: optText(1200),
  highlights: lines(8, 60),
  color: z.enum(CLASS_COLORS).default("green"),
  cardImageUrl: imageUrl,
  bannerImageUrl: imageUrl,
  displayOrder: z.coerce.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
});

export const classSubjectSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.enum(SUBJECT_CATEGORIES).default("MAIN"),
  description: optText(1200),
  outcomes: lines(12, 120),
  coverImageUrl: imageUrl,
  color: z.enum(SUBJECT_COLORS).default("pink"),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(100),
});

export type AcademicClassInput = z.infer<typeof academicClassSchema>;
export type ClassSubjectInput = z.infer<typeof classSubjectSchema>;
