import { createHmac } from 'node:crypto';
import * as gh from 'twilight-gh';
import { expect, test } from 'vitest';

const repo = 'thekevinscott/twilightfactory';
const secret = 'shh';
const detail = (number: number) => `https://api.github.com/repos/${repo}/pulls/${number}`;

// 51 conflicts, 52 merges cleanly, 53 is a conflicted draft.
// `unknown` makes the first N reads of a pull request say GitHub has not computed mergeability yet.
const setup = ({ unknown = {} as Record<number, number> } = {}) => {
  const session = proxySession('gh/conflicts');
  const counts = new Map<number, number>();
  const fetch = async (url: string, init: RequestInit) => {
    const response = await session.fetch(url, init);
    const number = Number(/\/pulls\/(\d+)$/.exec(new URL(url).pathname)?.[1]);
    const count = (counts.get(number) ?? 0) + 1;
    counts.set(number, count);
    if (count > (unknown[number] ?? 0)) return response;
    const body = { ...(await response.json()), mergeable: null, mergeable_state: 'unknown' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const events = gh.eventSource({
    github: gh.client('gho_gh', { request: { fetch } }),
    repo,
    secret,
    interval: 60_000,
    sources: [gh.pullRequestConflicted({ delay: 10 })],
  });
  const seen: gh.GitHubEvent[] = [];
  events.on('pull_request.conflicted', event => void seen.push(event));
  const read = (number: number) => session.requests.filter(({ url }) => url === detail(number)).length;
  return { events, seen, reads: read, requests: session.requests };
};

const deliver = (events: gh.EventSource, name: string, body: object) => {
  const payload = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return events.receive({ id: `${name}-${Math.random()}`, name, payload, signature });
};

const repository = { full_name: repo, default_branch: 'main' };
const pullRequest = (number: number, draft = false) => ({ number, draft, head: { ref: `branch-${number}`, sha: `sha${number}` } });

const conflicted = {
  type: 'pull_request.conflicted',
  via: 'webhook',
  key: '51:sha51',
  data: {
    number: 51,
    nodeId: 'PR_node51',
    title: 'Conflicts with main',
    url: `https://github.com/${repo}/pull/51`,
    draft: false,
    author: 'thekevinbot',
    head: 'branch-51',
    base: 'main',
    headSha: 'sha51',
  },
};

test('A push to the default branch checks every open pull request that is not a draft', async () => {
  const { events, seen, reads } = setup();
  await deliver(events, 'push', { ref: 'refs/heads/main', repository });
  await events.stop();
  expect(seen).toEqual([conflicted]);
  expect([reads(51), reads(52), reads(53)]).toEqual([1, 1, 0]);
});

test('A push to another branch checks nothing', async () => {
  const { events, seen, requests } = setup();
  await deliver(events, 'push', { ref: 'refs/heads/branch-52', repository });
  await events.stop();
  expect(seen).toEqual([]);
  expect(requests).toEqual([]);
});

test('A merged pull request checks every open pull request', async () => {
  const { events, seen, reads } = setup();
  await deliver(events, 'pull_request', { action: 'closed', number: 50, pull_request: { ...pullRequest(50), merged: true }, repository });
  await events.stop();
  expect(seen).toEqual([conflicted]);
  expect(reads(52)).toBe(1);
});

test('A pull request closed without merging checks nothing', async () => {
  const { events, seen, requests } = setup();
  await deliver(events, 'pull_request', { action: 'closed', number: 50, pull_request: { ...pullRequest(50), merged: false }, repository });
  await events.stop();
  expect(seen).toEqual([]);
  expect(requests).toEqual([]);
});

test.each(['opened', 'synchronize', 'reopened'])('A pull request %s checks that pull request', async action => {
  const { events, seen, reads } = setup();
  await deliver(events, 'pull_request', { action, number: 51, pull_request: pullRequest(51), repository });
  await events.stop();
  expect(seen).toEqual([conflicted]);
  expect([reads(51), reads(52)]).toEqual([1, 0]);
});

test('A push to a draft pull request checks nothing', async () => {
  const { events, seen, requests } = setup();
  await deliver(events, 'pull_request', { action: 'synchronize', number: 53, pull_request: pullRequest(53, true), repository });
  await events.stop();
  expect(seen).toEqual([]);
  expect(requests).toEqual([]);
});

test('A check reads the pull request again while GitHub reports mergeability as unknown', async () => {
  const { events, seen, reads } = setup({ unknown: { 51: 2 } });
  await deliver(events, 'pull_request', { action: 'synchronize', number: 51, pull_request: pullRequest(51), repository });
  await events.stop();
  expect(seen).toEqual([conflicted]);
  expect(reads(51)).toBe(3);
});

test('A check that never gets past unknown fires nothing', async () => {
  const { events, seen } = setup({ unknown: { 51: 100 } });
  await deliver(events, 'pull_request', { action: 'synchronize', number: 51, pull_request: pullRequest(51), repository });
  await events.stop();
  expect(seen).toEqual([]);
});

test('A conflict seen by webhook and then by poll fires once', async () => {
  const { events, seen } = setup();
  await deliver(events, 'push', { ref: 'refs/heads/main', repository });
  await events.start();
  await events.stop();
  expect(seen).toEqual([conflicted]);
});
