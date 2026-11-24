import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";
const run = (displayTitle: string, databaseId = 1): gh.Run => ({
  databaseId,
  status: "completed",
  conclusion: "success",
  createdAt: "2026-11-24T10:00:00Z",
  headSha: "abcdef0123",
  displayTitle,
  url: `https://github.com/${repo}/actions/runs/${databaseId}`,
});

let log: string;
process.env.PATH = `${join(import.meta.dirname, "bin")}${delimiter}${process.env.PATH}`;

beforeEach(() => {
  log = join(mkdtempSync(join(tmpdir(), "twilight-gh-")), "log");
  writeFileSync(log, "");
  process.env.GH_LOG = log;
});

const respond = (value: unknown) => {
  process.env.GH_STDOUT = JSON.stringify(value);
};
const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]);

const runList = (limit: string) => [
  "run", "list", "--repo", repo, "--workflow", gh.WORKFLOW, "--branch", "main", "--limit", limit,
  "--json", "databaseId,status,conclusion,createdAt,headSha,displayTitle,url",
];

test("lastRun returns the newest run on main", async () => {
  respond([run("Tests (plain)")]);
  expect(await gh.lastRun(repo)).toEqual(run("Tests (plain)"));
  expect(calls()).toEqual([runList("1")]);
});

test("lastRun returns null when there are no runs", async () => {
  respond([]);
  expect(await gh.lastRun(repo)).toBeNull();
});

test("lastMeasuredRun skips plain runs", async () => {
  respond([run("Tests (plain)", 3), run("Tests (measured)", 2), run("Tests (measured)", 1)]);
  expect(await gh.lastMeasuredRun(repo)).toEqual(run("Tests (measured)", 2));
  expect(calls()).toEqual([runList("100")]);
});

test("lastMeasuredRun returns null when no measured run is in the list", async () => {
  respond([run("Tests (plain)")]);
  expect(await gh.lastMeasuredRun(repo)).toBeNull();
});

test("head returns the sha of the default branch", async () => {
  respond({ sha: "abcdef0123" });
  expect(await gh.head(repo)).toBe("abcdef0123");
  expect(calls()).toEqual([["api", `repos/${repo}/commits/HEAD`]]);
});

test.for([
  [[{ number: 4 }], true],
  [[], false],
] as const)("openRedIssue is %j -> %s", async ([issues, expected]) => {
  respond(issues);
  expect(await gh.openRedIssue(repo)).toBe(expected);
  expect(calls()).toEqual([
    ["issue", "list", "--repo", repo, "--label", gh.RED_LABEL, "--state", "open", "--limit", "1", "--json", "number"],
  ]);
});

test("blockedPullRequests returns pull requests whose main-is-green check failed", async () => {
  const check = (workflowName: string, conclusion: string, runId: number) => ({
    workflowName,
    conclusion,
    detailsUrl: `https://github.com/${repo}/actions/runs/${runId}/job/99`,
  });
  respond([
    { number: 1, statusCheckRollup: [check(gh.MAIN_IS_GREEN, "FAILURE", 11)] },
    { number: 2, statusCheckRollup: [check(gh.MAIN_IS_GREEN, "SUCCESS", 12)] },
    { number: 3, statusCheckRollup: [check("Lint", "FAILURE", 13)] },
    { number: 4, statusCheckRollup: [] },
    { number: 5, statusCheckRollup: [check("Lint", "SUCCESS", 14), check(gh.MAIN_IS_GREEN, "FAILURE", 15)] },
  ]);
  expect(await gh.blockedPullRequests(repo)).toEqual([
    { number: 1, runId: 11 },
    { number: 5, runId: 15 },
  ]);
  expect(calls()).toEqual([
    ["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", "number,statusCheckRollup"],
  ]);
});

test.for(["plain", "measured"] as const)("startRun starts a %s run on main", async kind => {
  respond("");
  await gh.startRun(repo, kind);
  expect(calls()).toEqual([["workflow", "run", gh.WORKFLOW, "--repo", repo, "--ref", "main", "-f", `kind=${kind}`]]);
});

test("fileIssue opens a red issue pointing at the run", async () => {
  respond("");
  await gh.fileIssue(repo, run("Tests (plain)", 7));
  expect(calls()).toEqual([
    [
      "issue", "create", "--repo", repo, "--label", gh.RED_LABEL,
      "--title", "main is red at abcdef0",
      "--body", `Tests (plain) failed: https://github.com/${repo}/actions/runs/7`,
    ],
  ]);
});

test("rerunCheck re-runs the failed jobs of a run", async () => {
  respond("");
  await gh.rerunCheck(repo, 15);
  expect(calls()).toEqual([["run", "rerun", "15", "--repo", repo, "--failed"]]);
});

test("a gh error rejects", async () => {
  respond([]);
  process.env.GH_EXIT = "1";
  try {
    await expect(gh.lastRun(repo)).rejects.toThrow();
  } finally {
    delete process.env.GH_EXIT;
  }
});
