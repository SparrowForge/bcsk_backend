import { conflict } from "../../common/errors/app-error";

/**
 * The two application workflows as data: which status may follow which. A move not in the table is
 * refused with 409 - "illegal transitions return 409" is the B6 acceptance rule - so a decided
 * application can never be decided again, and a cancelled one never revived.
 */
export const LEAVE_FLOW: Record<string, readonly string[]> = {
  PENDING: ["REVIEWED", "APPROVED", "REJECTED", "CANCELLED"],
  REVIEWED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const TRANSFER_FLOW: Record<string, readonly string[]> = {
  SUBMITTED: ["VERIFIED", "REJECTED", "CANCELLED"],
  VERIFIED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canMove(flow: Record<string, readonly string[]>, from: string, to: string): boolean {
  return (flow[from] ?? []).includes(to);
}

export function assertMove(flow: Record<string, readonly string[]>, from: string, to: string, what: string): void {
  if (!canMove(flow, from, to)) {
    throw conflict(`This ${what} is ${from.toLowerCase()} and can't be ${to.toLowerCase()} now.`, { from, to });
  }
}

const DAY = 86_400_000;
/** Whole school days from `from` to `to`, both included. */
export const daysInclusive = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY) + 1;
/** Every school day from `from` to `to`, both included. */
export const eachDay = (from: Date, to: Date) => Array.from({ length: daysInclusive(from, to) }, (_, i) => new Date(from.getTime() + i * DAY));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekday = (d: Date) => WEEKDAYS[d.getUTCDay()]!;

/**
 * The attendance marks an approved leave excuses: every class of the student on a day of the
 * leave that meets on that weekday. Pure, so the rule is tested without a database.
 */
export function excusedMarks(slots: { id: number; dayOfWeek: string }[], from: Date, to: Date): { classSessionId: number; date: Date }[] {
  return eachDay(from, to).flatMap((date) => slots.filter((s) => s.dayOfWeek === weekday(date)).map((s) => ({ classSessionId: s.id, date })));
}
