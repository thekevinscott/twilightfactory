import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Conventions tf sets up in every repo.
export const WORKFLOW = "tests.yml";
export const RED_LABEL = "red";
export const MAIN_IS_GREEN = "Main is green";

export type Kind = "plain" | "measured";

export interface Run {
  databaseId: number;
  status: string;
  conclusion: string;
  createdAt: string;
  headSha: string;
  displayTitle: string;
  url: string;
}

export interface BlockedPullRequest {
  number: number;
  runId: number;
}

const gh = async (...args: string[]) => (await promisify(execFile)("gh", args)).stdout;

const runFields = "databaseId,status,conclusion,createdAt,headSha,displayTitle,url";

// The workflow sets `run-name: Tests (${{ inputs.kind }})`, so the kind shows in the title.
const runs = async (repo: string, limit: number): Promise<Run[]> =>
  JSON.parse(
    await gh("run", "list", "--repo", repo, "--workflow", WORKFLOW, "--branch", "main", "--limit", String(limit), "--json", runFields),
  ) as Run[];

export const lastRun = async (repo: string): Promise<Run | null> => (await runs(repo, 1))[0] ?? null;

// A day holds at most 24 plain runs, so the last measured run is within the newest 100.
export const lastMeasuredRun = async (repo: string): Promise<Run | null> =>
  (await runs(repo, 100)).find(run => run.displayTitle.includes("(measured)")) ?? null;

export const head = async (repo: string): Promise<string> =>
  (JSON.parse(await gh("api", `repos/${repo}/commits/HEAD`)) as { sha: string }).sha;

export const openRedIssue = async (repo: string): Promise<boolean> =>
  (JSON.parse(await gh("issue", "list", "--repo", repo, "--label", RED_LABEL, "--state", "open", "--limit", "1", "--json", "number")) as unknown[])
    .length > 0;

interface Check {
  workflowName?: string;
  conclusion?: string;
  detailsUrl?: string;
}

export const blockedPullRequests = async (repo: string): Promise<BlockedPullRequest[]> => {
  const pulls = JSON.parse(
    await gh("pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", "number,statusCheckRollup"),
  ) as { number: number; statusCheckRollup: Check[] }[];
  return pulls.flatMap(({ number, statusCheckRollup }) => {
    const check = statusCheckRollup.find(check => check.workflowName === MAIN_IS_GREEN && check.conclusion === "FAILURE");
    const runId = check?.detailsUrl?.match(/\/actions\/runs\/(\d+)/)?.[1];
    return runId ? [{ number, runId: Number(runId) }] : [];
  });
};

export const startRun = async (repo: string, kind: Kind): Promise<void> => {
  await gh("workflow", "run", WORKFLOW, "--repo", repo, "--ref", "main", "-f", `kind=${kind}`);
};

export const fileIssue = async (repo: string, run: Run): Promise<void> => {
  await gh(
    "issue", "create", "--repo", repo, "--label", RED_LABEL,
    "--title", `main is red at ${run.headSha.slice(0, 7)}`,
    "--body", `${run.displayTitle} failed: ${run.url}`,
  );
};

export const rerunCheck = async (repo: string, runId: number): Promise<void> => {
  await gh("run", "rerun", String(runId), "--repo", repo, "--failed");
};
