import { z } from "zod";

export const MATERIAL_KINDS = ["FILE", "LINK", "VIDEO"] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

/** A file uploaded to the materials folder: the path /files hands back, nothing else. */
const materialPath = z
  .string()
  .trim()
  .regex(/^materials\/[a-f0-9]{16}\.(pdf|jpg|png|webp)$/, "Upload the file first; use the path the upload returned.");
const httpsUrl = z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Use an https:// link.");

const base = z.object({
  subjectId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(160),
  description: optText(2000),
  kind: z.enum(MATERIAL_KINDS),
  fileUrl: materialPath.optional().nullable(),
  linkUrl: httpsUrl.optional().nullable(),
  published: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(100),
});

/** A FILE carries a stored path and no link; a LINK or VIDEO the reverse. */
const coherent = <T extends { kind: string; fileUrl?: string | null; linkUrl?: string | null }>(m: T) =>
  m.kind === "FILE" ? !!m.fileUrl && !m.linkUrl : !!m.linkUrl && !m.fileUrl;
const coherentMessage = { message: "A file needs an uploaded file; a link or video needs an https link.", path: ["kind"] };

/** Teacher: always for one of their sections, so the section comes from the URL. */
export const teacherMaterialSchema = base.refine(coherent, coherentMessage);

/** Head Master: a class, and optionally one section of it (none = every section). */
export const managedMaterialSchema = base
  .extend({
    courseLevelId: z.coerce.number().int().positive(),
    sectionId: z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null),
  })
  .refine(coherent, coherentMessage);

export const materialFilter = z.object({
  courseLevelId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  subjectId: z.coerce.number().int().positive().optional(),
});

export type TeacherMaterialInput = z.infer<typeof teacherMaterialSchema>;
export type ManagedMaterialInput = z.infer<typeof managedMaterialSchema>;
