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

test("confirmFix treats a timed out run as red", async () => {
  const { github, requests } = fakeSequence([
    [{ workflow_runs: [apiRun("Tests (plain)", 2), apiRun("Tests (measured)", 1, "timed_out")] }, 200],
    [null, 204],
  ]);
  expect(await gh.confirmFix(github, repo)).toBe("measured");
  expect(requests[1]).toEqual(dispatch("measured"));
});

test("confirmFix with no red run starts nothing", async () => {
  const { github, requests } = fake({ workflow_runs: [apiRun("Tests (plain)")] });
  await expect(gh.confirmFix(github, repo)).rejects.toThrow("no red run");
  expect(requests).toHaveLength(1);
});
