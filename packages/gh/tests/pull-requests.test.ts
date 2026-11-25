import { Webhooks } from "@octokit/webhooks";
import { expect, test, vi } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";
const secret = "shh";
const long_ago = "2020-01-01T00:00:00Z";

interface Pull {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  html_url: string;
  draft: boolean;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

const pull = (number: number, extra: Partial<Pull> = {}): Pull => ({
  number,
  node_id: `PR_${number}`,
  title: `title ${number}`,
  body: null,
  html_url: `https://github.com/owner/name/pull/${number}`,
  draft: false,
  user: { login: "someone" },
  head: { ref: `branch-${number}` },
  base: { ref: "main" },
  created_at: long_ago,
  updated_at: long_ago,
  closed_at: null,
  merged_at: null,
  ...extra,
});

const now = () => new Date().toISOString();

const fakeGitHub = () => {
  const state = { pulls: [] as Pull[] };
  const requests: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    requests.push(url);
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    const body = JSON.stringify(page === 1 ? state.pulls : []);
    const etag = `"${body.length}-${page}-${[...body].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 0)}"`;
    if (new Headers(init.headers).get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(body, { status: 200, headers: { "content-type": "application/json", etag } });
  };
  return { github: gh.client("token", { request: { fetch } }), state, requests };
};

const setup = () => {
  const fake = fakeGitHub();
  const events = gh.eventSource({
    github: fake.github,
    repo,
    secret,
    interval: 5,
    sources: [gh.pullRequestOpened(), gh.pullRequestEdited(), gh.pullRequestClosed()],
  });
  const seen: gh.GitHubEvent[] = [];
  for (const type of ["pull_request.opened", "pull_request.edited", "pull_request.closed"]) {
    events.on(type, event => void seen.push(event));
  }
  // Resolves once every source has polled at least twice more.
  const polls = async () => {
    const before = fake.requests.length;
    await vi.waitFor(() => expect(fake.requests.length).toBeGreaterThanOrEqual(before + 6));
  };
  return { ...fake, events, seen, polls };
};

const delivery = async (action: string, pr: Pull) => {
  const payload = JSON.stringify({ action, number: pr.number, pull_request: { ...pr, merged: pr.merged_at !== null } });
  return { id: `${action}-${pr.number}-${Math.random()}`, name: "pull_request", payload, signature: await new Webhooks({ secret }).sign(payload) };
};

const data = (pr: Pull) => ({
  number: pr.number,
  nodeId: pr.node_id,
  title: pr.title,
  url: pr.html_url,
  draft: pr.draft,
  author: pr.user.login,
  head: pr.head.ref,
  base: pr.base.ref,
});

test("an opened webhook fires pull_request.opened", async () => {
  const { events, seen } = setup();
  const pr = pull(1);
  await events.receive(await delivery("opened", pr));
  await events.stop();
  expect(seen).toEqual([{ type: "pull_request.opened", via: "webhook", key: "1", data: data(pr) }]);
});

test("an edited webhook fires pull_request.edited", async () => {
  const { events, seen } = setup();
  await events.receive(await delivery("edited", pull(2, { title: "new" })));
  await events.stop();
  expect(seen).toMatchObject([{ type: "pull_request.edited", via: "webhook", data: { number: 2, title: "new" } }]);
});

test("a closed webhook says whether the pull request merged", async () => {
  const { events, seen } = setup();
  const closed = "2026-11-25T10:00:00Z";
  await events.receive(await delivery("closed", pull(3, { closed_at: closed, merged_at: closed })));
  await events.receive(await delivery("closed", pull(4, { closed_at: closed })));
  await events.stop();
  expect(seen).toEqual([
    { type: "pull_request.closed", via: "webhook", key: `3:${closed}`, data: { ...data(pull(3)), merged: true } },
    { type: "pull_request.closed", via: "webhook", key: `4:${closed}`, data: { ...data(pull(4)), merged: false } },
  ]);
});

test("other pull request actions fire nothing", async () => {
  const { events, seen } = setup();
  await events.receive(await delivery("synchronize", pull(5)));
  await events.receive(await delivery("reopened", pull(5)));
  await events.receive(await delivery("labeled", pull(5)));
  await events.stop();
  expect(seen).toEqual([]);
});

test("the first poll fires nothing, even for open and closed pull requests", async () => {
  const { events, state, seen, requests, polls } = setup();
  state.pulls = [pull(6), pull(7, { closed_at: long_ago, merged_at: long_ago })];
  await events.start();
  await polls();
  await events.stop();
  expect(seen).toEqual([]);
  expect(requests[0]).toBe("https://api.github.com/repos/owner/name/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1");
});

test("a poll fires pull_request.opened for a pull request created since the last poll", async () => {
  const { events, state, seen } = setup();
  await events.start();
  const pr = pull(8, { created_at: now(), updated_at: now() });
  state.pulls = [pr];
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await events.stop();
  expect(seen).toEqual([{ type: "pull_request.opened", via: "poll", key: "8", data: data(pr) }]);
});

test("a poll fires pull_request.edited when the title, body or base changes", async () => {
  const { events, state, seen } = setup();
  state.pulls = [pull(9), pull(10), pull(11)];
  await events.start();
  state.pulls = [
    pull(9, { title: "renamed", updated_at: now() }),
    pull(10, { body: "described", updated_at: now() }),
    pull(11, { base: { ref: "develop" }, updated_at: now() }),
  ];
  await vi.waitFor(() => expect(seen).toHaveLength(3));
  await events.stop();
  expect(seen.map(({ type, via, data }) => ({ type, via, number: (data as { number: number }).number }))).toEqual([
    { type: "pull_request.edited", via: "poll", number: 9 },
    { type: "pull_request.edited", via: "poll", number: 10 },
    { type: "pull_request.edited", via: "poll", number: 11 },
  ]);
});

test("a poll does not call other activity an edit", async () => {
  const { events, state, seen, polls } = setup();
  state.pulls = [pull(12)];
  await events.start();
  state.pulls = [pull(12, { updated_at: now(), head: { ref: "branch-12" } })];
  await polls();
  await events.stop();
  expect(seen).toEqual([]);
});

test("a poll fires pull_request.closed and says whether it merged", async () => {
  const { events, state, seen } = setup();
  state.pulls = [pull(13), pull(14)];
  await events.start();
  const closed = now();
  state.pulls = [
    pull(13, { closed_at: closed, merged_at: closed, updated_at: closed }),
    pull(14, { closed_at: closed, updated_at: closed }),
  ];
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  await events.stop();
  expect(seen).toEqual([
    { type: "pull_request.closed", via: "poll", key: `13:${closed}`, data: { ...data(pull(13)), merged: true } },
    { type: "pull_request.closed", via: "poll", key: `14:${closed}`, data: { ...data(pull(14)), merged: false } },
  ]);
});

test("a poll fires nothing for pull requests closed before the last poll", async () => {
  const { events, state, seen, polls } = setup();
  await events.start();
  state.pulls = [pull(15, { closed_at: long_ago, merged_at: long_ago, updated_at: now() })];
  await polls();
  await events.stop();
  expect(seen).toEqual([]);
});

const changes: [string, (pr: Pull) => Pull, (pr: Pull) => Pull][] = [
  ["opened", pr => pr, pr => ({ ...pr, created_at: now(), updated_at: now() })],
  ["edited", pr => pr, pr => ({ ...pr, title: "renamed", updated_at: now() })],
  ["closed", pr => pr, pr => ({ ...pr, closed_at: now(), merged_at: now(), updated_at: now() })],
];

test.each(changes)("a %s change seen by webhook and then by poll fires once", async (action, before, after) => {
  const { events, state, seen, polls } = setup();
  const pr = pull(16);
  if (action !== "opened") state.pulls = [before(pr)];
  await events.start();
  const changed = after(pr);
  await events.receive(await delivery(action, changed));
  state.pulls = [changed];
  await polls();
  await events.stop();
  expect(seen.map(({ type, via }) => ({ type, via }))).toEqual([{ type: `pull_request.${action}`, via: "webhook" }]);
});

test.each(changes)("a %s change seen by poll and then by webhook fires once", async (action, before, after) => {
  const { events, state, seen } = setup();
  const pr = pull(17);
  if (action !== "opened") state.pulls = [before(pr)];
  await events.start();
  const changed = after(pr);
  state.pulls = [changed];
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await events.receive(await delivery(action, changed));
  await events.stop();
  expect(seen.map(({ type, via }) => ({ type, via }))).toEqual([{ type: `pull_request.${action}`, via: "poll" }]);
});
