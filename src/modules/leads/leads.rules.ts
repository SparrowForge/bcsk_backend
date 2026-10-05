import { OPEN_STAGES, type LeadStage } from "./leads.schema";

/** Points a lead earns for reaching each stage. Recalculated on every stage change. */
export const STAGE_SCORE: Record<LeadStage, number> = {
  NEW: 10, CONTACTED: 30, QUALIFIED: 50, APPLIED: 70, ADMITTED: 90, ENROLLED: 100, LOST: 0,
};

/**
 * A lead may move forward or backward through the open stages, and to LOST from anywhere. It
 * may not leave ENROLLED, and a LOST lead may only be reopened. Returns an error message, or
 * null when the move is allowed. ENROLLED is reached by converting, never by a stage change.
 */
export function stageMoveError(from: LeadStage, to: LeadStage): string | null {
  if (to === "ENROLLED") return "A lead becomes enrolled by being converted to an application.";
  if (from === to) return `The lead is already at the ${to} stage.`;
  if (from === "ENROLLED") return "A converted lead can no longer change stage.";
  if (to === "LOST" || from === "LOST") return null;
  if (!OPEN_STAGES.includes(from) || !OPEN_STAGES.includes(to)) return `Cannot move a lead from ${from} to ${to}.`;
  return null;
}

/** LD-YYMM-NNNN. */
export function leadNoPrefix(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `LD-${yy}${mm}-`;
}

export const formatLeadNo = (prefix: string, sequence: number) => `${prefix}${String(sequence).padStart(4, "0")}`;

export const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v ? new Date(v) : null;
