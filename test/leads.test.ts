import { describe, it, expect } from "vitest";
import { STAGE_SCORE, formatLeadNo, leadNoPrefix, stageMoveError } from "../src/modules/leads/leads.rules";
import { createLeadSchema, publicEnquirySchema, stageSchema } from "../src/modules/leads/leads.schema";

describe("CRM stage moves", () => {
  it("lets a lead move forward and backward through the open stages", () => {
    expect(stageMoveError("NEW", "QUALIFIED")).toBeNull();
    expect(stageMoveError("ADMITTED", "CONTACTED")).toBeNull();
  });
  it("allows LOST from anywhere open, and reopening a lost lead", () => {
    expect(stageMoveError("QUALIFIED", "LOST")).toBeNull();
    expect(stageMoveError("LOST", "NEW")).toBeNull();
  });
  it("never reaches ENROLLED by a stage change - only by converting", () => {
    expect(stageMoveError("ADMITTED", "ENROLLED")).toMatch(/converted/i);
  });
  it("freezes a converted lead and rejects a no-op", () => {
    expect(stageMoveError("ENROLLED", "NEW")).toMatch(/converted/i);
    expect(stageMoveError("ENROLLED", "LOST")).toMatch(/converted/i);
    expect(stageMoveError("NEW", "NEW")).toMatch(/already/i);
  });
  it("scores progress upward and a lost lead at zero", () => {
    expect(STAGE_SCORE.NEW).toBeLessThan(STAGE_SCORE.ADMITTED);
    expect(STAGE_SCORE.ENROLLED).toBe(100);
    expect(STAGE_SCORE.LOST).toBe(0);
  });
});

describe("lead numbers", () => {
  it("formats LD-YYMM-NNNN", () => {
    expect(leadNoPrefix(new Date(2026, 8, 5))).toBe("LD-2609-");
    expect(formatLeadNo("LD-2609-", 42)).toBe("LD-2609-0042");
    expect(formatLeadNo("LD-2609-", 12345)).toBe("LD-2609-12345");
  });
});

describe("CRM input validation", () => {
  it("needs an email or a phone to avoid unreachable leads", () => {
    expect(createLeadSchema.safeParse({ name: "Rahim" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ name: "Rahim", phone: "01012345678" }).success).toBe(true);
    expect(createLeadSchema.safeParse({ name: "Rahim", email: "r@example.com" }).success).toBe(true);
  });
  it("requires a lost reason's value to be one of the known ones", () => {
    expect(stageSchema.safeParse({ stage: "LOST", lostReason: "BOGUS" }).success).toBe(false);
    expect(stageSchema.safeParse({ stage: "LOST", lostReason: "FEES_TOO_HIGH" }).success).toBe(true);
  });
  it("lets the public form set neither stage nor owner", () => {
    const parsed = publicEnquirySchema.parse({
      name: "Karim", phone: "01099999999", stage: "ADMITTED", assignedToUserId: 1, score: 100,
    });
    expect(parsed).not.toHaveProperty("stage");
    expect(parsed).not.toHaveProperty("assignedToUserId");
    expect(parsed).not.toHaveProperty("score");
  });
});
