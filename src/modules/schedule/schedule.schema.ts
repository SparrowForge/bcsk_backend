import { z } from "zod";

export const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export const EVENT_TYPES = ["TERM", "HOLIDAY", "EXAM", "EVENT", "MEETING"] as const;
export const AUDIENCES = ["ALL", "STUDENTS", "TEACHERS", "STAFF"] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optId = z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null);
/** 24-hour "HH:MM". */
const clock = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, like 18:30.");
/** A whole school day, "YYYY-MM-DD", stored at midnight UTC. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Not a real date.");
/** A meeting link: https only, never a script or a local address. */
const meetingUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith("https://"), "Use an https:// meeting link.")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);
const instant = z
  .string()
  .datetime({ offset: true, message: "Use an ISO date-time with its offset, like 2026-11-07T18:30:00+09:00." })
  .transform((v) => new Date(v));

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const slotSchema = z
  .object({
    sectionId: z.coerce.number().int().positive(),
    subjectId: z.coerce.number().int().positive(),
    teacherProfileId: optId,
    dayOfWeek: z.enum(DAYS),
    startTime: clock,
    endTime: clock,
    room: optText(60),
    zoomLink: meetingUrl,
  })
  .refine((s) => toMinutes(s.endTime) > toMinutes(s.startTime), { message: "A class must end after it starts.", path: ["endTime"] });

export const slotUpdateSchema = z
  .object({
    teacherProfileId: optId,
    dayOfWeek: z.enum(DAYS),
    startTime: clock,
    endTime: clock,
    room: optText(60),
    zoomLink: meetingUrl,
    notice: optText(300),
  })
  .refine((s) => toMinutes(s.endTime) > toMinutes(s.startTime), { message: "A class must end after it starts.", path: ["endTime"] });

export const routineFilter = z.object({
  termId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  teacherProfileId: z.coerce.number().int().positive().optional(),
});

export const eventSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: optText(2000),
    type: z.enum(EVENT_TYPES),
    audience: z.enum(AUDIENCES).default("ALL"),
    startDate: day,
    endDate: day,
    termId: optId,
    courseLevelId: optId,
    published: z.boolean().default(false),
  })
  .refine((e) => e.endDate >= e.startDate, { message: "An event must end on or after its first day.", path: ["endDate"] });

/** At most about a year and a month, so a feed is never the whole history in one response. */
export const rangeSchema = z
  .object({ from: day.optional(), to: day.optional() })
  .transform(({ from, to }) => {
    const start = from ?? new Date(Date.now() - 30 * 86_400_000);
    const end = to ?? new Date(start.getTime() + 210 * 86_400_000);
    return { from: start, to: end };
  })
  .refine((r) => r.to >= r.from && r.to.getTime() - r.from.getTime() <= 400 * 86_400_000, "Choose a range of at most 400 days.");

export const onlineClassSchema = z
  .object({
    startsAt: instant,
    endsAt: instant,
    topic: optText(200),
    joinUrl: meetingUrl,
  })
  .refine((o) => o.endsAt > o.startsAt, { message: "A class must end after it starts.", path: ["endsAt"] })
  .refine((o) => o.endsAt.getTime() - o.startsAt.getTime() <= 6 * 3_600_000, { message: "One online class runs at most six hours.", path: ["endsAt"] });

export const endClassSchema = z.object({ recordingUrl: meetingUrl });
export const cancelClassSchema = z.object({ reason: optText(300) });

export type SlotInput = z.infer<typeof slotSchema>;
export type SlotUpdateInput = z.infer<typeof slotUpdateSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type Range = z.infer<typeof rangeSchema>;
export type OnlineClassInput = z.infer<typeof onlineClassSchema>;
