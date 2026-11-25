import { expect, test } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";

const answering = (respond: (url: URL) => unknown) => {
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify(respond(new URL(url))), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { github: gh.client("token", { request: { fetch } }), requests };
};

const apiPull = (number: number, closed_at: string | null = null, merged = false) => ({
  number,
  title: `title ${number}`,
  html_url: `https://github.com/${repo}/pull/${number}`,
  draft: number === 2,
  user: { login: "someone" },
  head: { ref: `branch-${number}` },
  closed_at,
  merged_at: merged ? closed_at : null,
});

test("pullRequestSummaries lists open pull requests, then recently closed ones", async () => {
  const { github } = answering(url =>
    url.searchParams.get("state") === "open"
      ? [apiPull(1), apiPull(2)]
      : [apiPull(3, "2026-11-24T10:00:00Z", true), apiPull(4, "2026-11-24T09:00:00Z")],
  );
  const prs = await gh.pullRequestSummaries(github, repo);
  expect(prs.map(pr => [pr.number, pr.state, pr.draft])).toEqual([
    [1, "open", false],
    [2, "open", true],
    [3, "merged", false],
    [4, "closed", false],
  ]);
});

test("openIssues leaves out pull requests", async () => {
  const { github, requests } = answering(() => [
    { number: 5, title: "a bug", html_url: "https://github.com/owner/name/issues/5", labels: [{ name: "red" }, "plain"] },
    { number: 6, title: "a pr", html_url: "https://github.com/owner/name/pull/6", labels: [], pull_request: {} },
  ]);
  expect(await gh.openIssues(github, repo)).toEqual([
    { number: 5, title: "a bug", url: "https://github.com/owner/name/issues/5", labels: ["red", "plain"] },
  ]);
  expect(requests[0]).toContain("state=open");
});

test("pullRequestLine fits a pull request on one line", () => {
  expect(
    gh.pullRequestLine({
      number: 7,
      title: 'Fix "it"',
      url: "https://github.com/owner/name/pull/7",
      draft: true,
      author: "someone",
      head: "fix-it",
      state: "open",
    }),
  ).toBe('#7 open draft "Fix \\"it\\"" by someone from fix-it https://github.com/owner/name/pull/7');
});

test("issueLine shows labels only when there are some", () => {
  const issue = { number: 5, title: "a bug", url: "https://github.com/owner/name/issues/5", labels: [] };
  expect(gh.issueLine(issue)).toBe('#5 "a bug" https://github.com/owner/name/issues/5');
  expect(gh.issueLine({ ...issue, labels: ["red"] })).toBe('#5 "a bug" [red] https://github.com/owner/name/issues/5');
});

test("runLine shows the kind, status, conclusion and short head", () => {
  const run = {
    id: 1,
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-11-24T10:00:00Z",
    headSha: "abcdef0123",
    displayTitle: "Tests (measured)",
    url: "https://github.com/owner/name/actions/runs/1",
  };
  expect(gh.runLine(run)).toBe("measured completed failure abcdef0 2026-11-24T10:00:00Z https://github.com/owner/name/actions/runs/1");
  expect(gh.runLine({ ...run, status: "in_progress", conclusion: "", displayTitle: "Tests (plain)" })).toBe(
    "plain in_progress abcdef0 2026-11-24T10:00:00Z https://github.com/owner/name/actions/runs/1",
  );
});
