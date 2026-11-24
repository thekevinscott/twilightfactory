import { expect, test } from "vitest";
import { type Run, state } from "./state.js";

const now = new Date("2026-11-23T12:00:00Z");
const inputs = (createdAt: string) => ({
  hasWorkflow: async () => true,
  lastRun: async (): Promise<Run> => ({ status: "completed", conclusion: "success", createdAt, headSha: "aaa" }),
  head: async () => "bbb",
  lastMeasuredRun: async () => null,
  blockedPullRequests: async () => 0,
  openRedIssue: async () => false,
});

test("a pass under an hour old is quiet, even with new commits", async () => {
  expect(await state(inputs("2026-11-23T11:00:01Z"), [], now)).toBe("QUIET");
});

test("a pass exactly an hour old goes when there are new commits", async () => {
  expect(await state(inputs("2026-11-23T11:00:00Z"), [], now)).toBe("GO_MEASURED");
});
