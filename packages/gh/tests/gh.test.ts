import { expect, test } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";
const api = "https://api.github.com";

interface Request {
  method: string;
  url: string;
  body?: unknown;
}

// An Octokit client whose requests are recorded and answered in turn from `responses`.
const fakeSequence = (responses: [unknown, number][]) => {
  const requests: Request[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const [response, status] = responses[requests.length] ?? [null, 500];
    requests.push({
      method: init.method ?? "GET",
      url,
      ...(init.body ? { body: JSON.parse(init.body as string) } : {}),
    });
    return new Response(status === 204 ? null : JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { github: gh.client("token", { request: { fetch } }), requests };
};
const fake = (response: unknown, status = 200) => fakeSequence([[response, status]]);

const apiRun = (display_title: string, id = 1, conclusion: string | null = "success") => ({
  id,
  status: "completed",
  conclusion,
  created_at: "2026-11-24T10:00:00Z",
  head_sha: "abcdef0123",
  display_title,
  html_url: `https://github.com/${repo}/actions/runs/${id}`,
});
const run = (displayTitle: string, id = 1, conclusion = "success"): gh.Run => ({
  id,
  status: "completed",
  conclusion,
  createdAt: "2026-11-24T10:00:00Z",
  headSha: "abcdef0123",
  displayTitle,
  url: `https://github.com/${repo}/actions/runs/${id}`,
});
const runsUrl = (perPage: number) =>
  `${api}/repos/owner/name/actions/workflows/${gh.WORKFLOW}/runs?branch=main&per_page=${perPage}`;

test("hasWorkflow is true when the tests workflow exists", async () => {
  const { github, requests } = fake({ id: 1, path: ".github/workflows/tests.yml" });
  expect(await gh.hasWorkflow(github, repo)).toBe(true);
  expect(requests).toEqual([{ method: "GET", url: `${api}/repos/${repo}/actions/workflows/tests.yml` }]);
});

test("hasWorkflow is false when the tests workflow is missing", async () => {
  const { github } = fake({ message: "Not Found" }, 404);
  expect(await gh.hasWorkflow(github, repo)).toBe(false);
});

test("hasWorkflow rejects on other errors", async () => {
  const { github } = fake({ message: "Server Error" }, 500);
  await expect(gh.hasWorkflow(github, repo)).rejects.toThrow();
});

test("lastRun returns the newest run on main", async () => {
  const { github, requests } = fake({ workflow_runs: [apiRun("Tests (plain)")] });
  expect(await gh.lastRun(github, repo)).toEqual(run("Tests (plain)"));
  expect(requests).toEqual([{ method: "GET", url: runsUrl(1) }]);
});

test("lastRun returns null when there are no runs", async () => {
  const { github } = fake({ workflow_runs: [] });
  expect(await gh.lastRun(github, repo)).toBeNull();
});

test("lastRun reports a run in progress with an empty conclusion", async () => {
  const { github } = fake({ workflow_runs: [{ ...apiRun("Tests (plain)", 1, null), status: "in_progress" }] });
  expect(await gh.lastRun(github, repo)).toEqual({ ...run("Tests (plain)", 1, ""), status: "in_progress" });
});

test("lastMeasuredRun skips plain runs", async () => {
  const { github, requests } = fake({
    workflow_runs: [apiRun("Tests (plain)", 3), apiRun("Tests (measured)", 2), apiRun("Tests (measured)", 1)],
  });
  expect(await gh.lastMeasuredRun(github, repo)).toEqual(run("Tests (measured)", 2));
  expect(requests).toEqual([{ method: "GET", url: runsUrl(100) }]);
});

test("lastMeasuredRun returns null when no measured run is in the list", async () => {
  const { github } = fake({ workflow_runs: [apiRun("Tests (plain)")] });
  expect(await gh.lastMeasuredRun(github, repo)).toBeNull();
});

test("head returns the sha of the default branch", async () => {
  const { github, requests } = fake({ sha: "abcdef0123" });
  expect(await gh.head(github, repo)).toBe("abcdef0123");
  expect(requests).toEqual([{ method: "GET", url: `${api}/repos/owner/name/commits/HEAD` }]);
});

test.for([
  ["an open red issue", [{ number: 4 }], true],
  ["no open red issue", [], false],
  ["only a pull request labelled red", [{ number: 5, pull_request: {} }], false],
] as const)("openRedIssue with %s is %s", async ([, issues, expected]) => {
  const { github, requests } = fake(issues);
  expect(await gh.openRedIssue(github, repo)).toBe(expected);
  expect(requests).toEqual([
    { method: "GET", url: `${api}/repos/owner/name/issues?labels=${gh.RED_LABEL}&state=open&per_page=100` },
  ]);
});

test("blockedPullRequests returns pull requests whose main-is-green check failed", async () => {
  const check = (workflow: string, conclusion: string, databaseId: number) => ({
    conclusion,
    checkSuite: { workflowRun: { databaseId, workflow: { name: workflow } } },
  });
  const pull = (number: number, checks: unknown[] | null) => ({
    number,
    commits: { nodes: [{ commit: { statusCheckRollup: checks && { contexts: { nodes: checks } } } }] },
  });
  const { github, requests } = fake({
    data: {
      repository: {
        pullRequests: {
          nodes: [
            pull(1, [check(gh.MAIN_IS_GREEN, "FAILURE", 11)]),
            pull(2, [check(gh.MAIN_IS_GREEN, "SUCCESS", 12)]),
            pull(3, [check("Lint", "FAILURE", 13)]),
            pull(4, null),
            pull(5, [check("Lint", "SUCCESS", 14), check(gh.MAIN_IS_GREEN, "FAILURE", 15)]),
            pull(6, [{}]),
          ],
        },
      },
    },
  });
  expect(await gh.blockedPullRequests(github, repo)).toEqual([
    { number: 1, runId: 11 },
    { number: 5, runId: 15 },
  ]);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: "POST", url: `${api}/graphql`, body: { variables: { owner: "owner", repo: "name" } } });
});

test.for(["plain", "measured"] as const)("startRun starts a %s run on main", async kind => {
  const { github, requests } = fake(null, 204);
  await gh.startRun(github, repo, kind);
  expect(requests).toEqual([
    {
      method: "POST",
      url: `${api}/repos/owner/name/actions/workflows/${gh.WORKFLOW}/dispatches`,
      body: { ref: "main", inputs: { kind } },
    },
  ]);
});

test("fileIssue opens a red issue pointing at the run", async () => {
  const { github, requests } = fake({ number: 9 }, 201);
  await gh.fileIssue(github, repo, run("Tests (plain)", 7, "failure"));
  expect(requests).toEqual([
    {
      method: "POST",
      url: `${api}/repos/owner/name/issues`,
      body: {
        labels: [gh.RED_LABEL],
        title: "main is red at abcdef0",
        body: `Tests (plain) failed: https://github.com/${repo}/actions/runs/7`,
      },
    },
  ]);
});

test("rerunCheck re-runs the failed jobs of a run", async () => {
  const { github, requests } = fake({}, 201);
  await gh.rerunCheck(github, repo, 15);
  expect(requests).toEqual([{ method: "POST", url: `${api}/repos/owner/name/actions/runs/15/rerun-failed-jobs` }]);
});

test("an API error rejects", async () => {
  const { github } = fake({ message: "Bad credentials" }, 401);
  await expect(gh.lastRun(github, repo)).rejects.toThrow("Bad credentials");
});

const dispatch = (kind: gh.Kind) => ({
  method: "POST",
  url: `${api}/repos/owner/name/actions/workflows/${gh.WORKFLOW}/dispatches`,
  body: { ref: "main", inputs: { kind } },
});

test.for([
  ["a measured run", "measured"],
  ["a plain run", "plain"],
] as const)("confirmFix after %s went red starts a %s run", async ([, kind]) => {
  const { github, requests } = fakeSequence([
    [{ workflow_runs: [{ ...apiRun("Tests (plain)", 3, null), status: "in_progress" }, apiRun(`Tests (${kind})`, 2, "failure"), apiRun("Tests (measured)", 1)] }, 200],
    [null, 204],
  ]);
  expect(await gh.confirmFix(github, repo)).toBe(kind);
  expect(requests).toEqual([{ method: "GET", url: runsUrl(100) }, dispatch(kind)]);
});

test.for(["timed_out", "cancelled", "startup_failure", "skipped"])("confirmFix treats a %s run as red", async conclusion => {
  const { github, requests } = fakeSequence([
    [{ workflow_runs: [apiRun("Tests (plain)", 2), apiRun("Tests (measured)", 1, conclusion)] }, 200],
    [null, 204],
  ]);
  expect(await gh.confirmFix(github, repo)).toBe("measured");
  expect(requests[1]).toEqual(dispatch("measured"));
});

test("confirmFix skips a run still in progress", async () => {
  const { github } = fake({ workflow_runs: [{ ...apiRun("Tests (measured)", 2, null), status: "in_progress" }, apiRun("Tests (plain)")] });
  await expect(gh.confirmFix(github, repo)).rejects.toThrow("no red run");
});

test("confirmFix with no red run starts nothing", async () => {
  const { github, requests } = fake({ workflow_runs: [apiRun("Tests (plain)")] });
  await expect(gh.confirmFix(github, repo)).rejects.toThrow("no red run");
  expect(requests).toHaveLength(1);
});

const apiPull = (number: number, closed_at: string | null = null, merged = false) => ({
  number,
  title: `title ${number}`,
  html_url: `https://github.com/${repo}/pull/${number}`,
  draft: number === 2,
  closed_at,
  merged_at: merged ? closed_at : null,
});
const statusOf = (number: number, state: gh.PullRequestStatus["state"]): gh.PullRequestStatus => ({
  number,
  title: `title ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  draft: number === 2,
  state,
});

// Answers by the `state` query parameter, so the order the two requests go out in doesn't matter.
const fakePulls = (open: unknown[], closed: unknown[]) => {
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    const body = new URL(url).searchParams.get("state") === "open" ? open : closed;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { github: gh.client("token", { request: { fetch } }), requests };
};

test("recentPullRequests lists every open pull request, then the 5 most recently closed", async () => {
  const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}T00:00:00Z`;
  // Sorted by last update, which is not the order they closed in.
  const closed = [
    apiPull(10, day(10), true),
    apiPull(11, day(20)),
    apiPull(12, day(12), true),
    apiPull(13, day(13), true),
    apiPull(14, day(1)),
    apiPull(15, day(15), true),
    apiPull(16, day(16)),
  ];
  const { github, requests } = fakePulls([apiPull(1), apiPull(2), apiPull(3)], closed);
  expect(await gh.recentPullRequests(github, repo)).toEqual([
    statusOf(1, "open"),
    statusOf(2, "open"),
    statusOf(3, "open"),
    statusOf(11, "closed"),
    statusOf(16, "closed"),
    statusOf(15, "merged"),
    statusOf(13, "merged"),
    statusOf(12, "merged"),
  ]);
  expect(requests.sort()).toEqual([
    `${api}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    `${api}/repos/${repo}/pulls?state=open&per_page=100`,
  ]);
});

test("recentPullRequests is empty when the repo has no pull requests", async () => {
  const { github } = fakePulls([], []);
  expect(await gh.recentPullRequests(github, repo)).toEqual([]);
});
