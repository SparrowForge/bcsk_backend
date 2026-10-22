import { z } from "zod";
import { TEMPLATE_TYPES, unknownPlaceholders } from "./templates";

const optId = z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null);
export const LANGS = ["en", "bn", "ko"] as const;
export const CERTIFICATE_TYPES = ["COMPLETION", "CHARACTER"] as const;

export const noteSchema = z.object({ note: z.string().trim().min(5, "Give the teachers or the record a reason.").max(500) });

export const templateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(10).max(4000),
    signatoryName: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
    signatoryTitle: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  })
  .superRefine((t, ctx) => {
    const unknown = unknownPlaceholders(`${t.title} ${t.body}`);
    if (unknown.length) ctx.addIssue({ code: "custom", message: `Unknown placeholder: {{${unknown[0]}}}.`, path: ["body"] });
  });
export const templateKey = z.object({ type: z.enum(TEMPLATE_TYPES), lang: z.enum(LANGS) });

export const issueSchema = z.object({
  studentUserId: z.coerce.number().int().positive(),
  type: z.enum(CERTIFICATE_TYPES),
  lang: z.enum(LANGS).default("en"),
  examId: optId,
  termId: optId,
});
export const bulkIssueSchema = z.object({
  sectionId: z.coerce.number().int().positive(),
  type: z.enum(CERTIFICATE_TYPES),
  lang: z.enum(LANGS).default("en"),
  examId: optId,
});
export const rankTiesSchema = z.object({ rankTies: z.enum(["SHARED", "SPLIT"]) });
