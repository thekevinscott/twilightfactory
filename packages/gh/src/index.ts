import { Octokit } from "@octokit/rest";

// Conventions tf sets up in every repo.
export const WORKFLOW = "tests.yml";
export const RED_LABEL = "red";
export const MAIN_IS_GREEN = "Main is green";

export type Kind = "plain" | "measured";

export interface Run {
  id: number;
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

export const client = (token: string, options: ConstructorParameters<typeof Octokit>[0] = {}): Octokit =>
  new Octokit({ auth: token, ...options });

const split = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
};

// The workflow sets `run-name: Tests (${{ inputs.kind }})`, so the kind shows in the title.
const runs = async (github: Octokit, repo: string, perPage: number): Promise<Run[]> => {
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...split(repo),
    workflow_id: WORKFLOW,
    branch: "main",
    per_page: perPage,
  });
  return data.workflow_runs.map(run => ({
    id: run.id,
    status: run.status ?? "",
    conclusion: run.conclusion ?? "",
    createdAt: run.created_at,
    headSha: run.head_sha,
    displayTitle: run.display_title,
    url: run.html_url,
  }));
};

export const hasWorkflow = async (github: Octokit, repo: string): Promise<boolean> => {
  try {
    await github.rest.actions.getWorkflow({ ...split(repo), workflow_id: WORKFLOW });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return false;
    throw error;
  }
};

export const lastRun = async (github: Octokit, repo: string): Promise<Run | null> =>
  (await runs(github, repo, 1))[0] ?? null;

// A day holds at most 24 plain runs, so the last measured run is within the newest 100.
export const lastMeasuredRun = async (github: Octokit, repo: string): Promise<Run | null> =>
  (await runs(github, repo, 100)).find(run => run.displayTitle.includes("(measured)")) ?? null;

export const head = async (github: Octokit, repo: string): Promise<string> =>
  (await github.rest.repos.getCommit({ ...split(repo), ref: "HEAD" })).data.sha;

export const openRedIssue = async (github: Octokit, repo: string): Promise<boolean> => {
  const { data } = await github.rest.issues.listForRepo({ ...split(repo), labels: RED_LABEL, state: "open", per_page: 100 });
  return data.some(issue => !issue.pull_request);
};

const blockedQuery = `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 100) {
      nodes {
        number
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun {
                      conclusion
                      checkSuite { workflowRun { databaseId workflow { name } } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface CheckRun {
  conclusion?: string | null;
  checkSuite?: { workflowRun: { databaseId: number; workflow: { name: string } } | null };
}

interface BlockedResponse {
  repository: {
    pullRequests: {
      nodes: {
        number: number;
        commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: CheckRun[] } } | null } }[] };
      }[];
    };
  };
}

export const blockedPullRequests = async (github: Octokit, repo: string): Promise<BlockedPullRequest[]> => {
  const data = await github.graphql<BlockedResponse>(blockedQuery, split(repo));
  return data.repository.pullRequests.nodes.flatMap(({ number, commits }) => {
    const checks = commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
    const failed = checks.find(
      check => check.conclusion === "FAILURE" && check.checkSuite?.workflowRun?.workflow.name === MAIN_IS_GREEN,
    );
    const runId = failed?.checkSuite?.workflowRun?.databaseId;
    return runId === undefined ? [] : [{ number, runId }];
  });
};

export const startRun = async (github: Octokit, repo: string, kind: Kind): Promise<void> => {
  await github.rest.actions.createWorkflowDispatch({ ...split(repo), workflow_id: WORKFLOW, ref: "main", inputs: { kind } });
};

export const fileIssue = async (github: Octokit, repo: string, run: Run): Promise<void> => {
  await github.rest.issues.create({
    ...split(repo),
    labels: [RED_LABEL],
    title: `main is red at ${run.headSha.slice(0, 7)}`,
    body: `${run.displayTitle} failed: ${run.url}`,
  });
};

export const rerunCheck = async (github: Octokit, repo: string, runId: number): Promise<void> => {
  await github.rest.actions.reRunWorkflowFailedJobs({ ...split(repo), run_id: runId });
};

export interface PullRequestStatus {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  state: "open" | "merged" | "closed";
}

const CLOSED_SHOWN = 5;
// GitHub can't sort by close time, so read a margin of recently updated ones and sort those.
const CLOSED_SCANNED = 30;

export const recentPullRequests = async (github: Octokit, repo: string): Promise<PullRequestStatus[]> => {
  const [open, closed] = await Promise.all([
    github.rest.pulls.list({ ...split(repo), state: "open", per_page: 100 }),
    github.rest.pulls.list({ ...split(repo), state: "closed", sort: "updated", direction: "desc", per_page: CLOSED_SCANNED }),
  ]);
  const status = (pr: (typeof open.data)[number]): PullRequestStatus => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    draft: pr.draft ?? false,
    state: pr.closed_at === null ? "open" : pr.merged_at === null ? "closed" : "merged",
  });
  const recentlyClosed = closed.data
    .filter(pr => pr.closed_at !== null)
    .sort((a, b) => Date.parse(b.closed_at!) - Date.parse(a.closed_at!))
    .slice(0, CLOSED_SHOWN);
  return [...open.data.filter(pr => pr.closed_at === null), ...recentlyClosed].map(status);
};

const isRed = (run: Run) => run.status === "completed" && run.conclusion !== "success";

// The fixer confirms with the kind of run that went red, so a speed or memory failure is re-measured.
export const confirmFix = async (github: Octokit, repo: string): Promise<Kind> => {
  const red = (await runs(github, repo, 100)).find(isRed);
  if (red === undefined) {
    throw new Error(`no red run of ${WORKFLOW} on main in ${repo}`);
  }
  const kind = red.displayTitle.includes("(measured)") ? "measured" : "plain";
  await startRun(github, repo, kind);
  return kind;
};
export * from "./events.js";
export * from "./pull-requests.js";
