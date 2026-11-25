import * as gh from 'twilight-gh';
import { expect, test } from 'vitest';

const repo = 'thekevinscott/twilightfactory';

// The fixture's recent changes are stamped 2099, so they fall after any real `since`; the rest are stamped 2020.
const poll = async (polls: number) => {
  const session = proxySession('gh/pulls');
  let count = 0;
  let done = () => {};
  const finished = new Promise<void>(resolve => (done = resolve));
  const counter = gh.defineSource({ type: 'count', poll: async () => (++count >= polls && done(), []) });
  const events = gh.eventSource({
    github: gh.client('gho_gh', { request: { fetch: session.fetch } }),
    secret: 'unused',
    repo,
    interval: 10,
    sources: [gh.pullRequestOpened(), gh.pullRequestEdited(), gh.pullRequestClosed(), counter],
    onError: error => console.error(error),
  });
  const seen: gh.GitHubEvent[] = [];
  for (const type of ['pull_request.opened', 'pull_request.edited', 'pull_request.closed']) events.on(type, event => void seen.push(event));
  await events.start();
  await finished;
  await events.stop();
  return { events: seen, requests: session.requests };
};

const pr = (number: number, title: string) => ({
  number,
  nodeId: `PR_node${number}`,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  draft: number === 21,
  author: 'thekevinbot',
  head: `branch-${number}`,
  base: 'main',
});

test('It fires nothing on the first poll after a start', async () => {
  const { events, requests } = await poll(1);
  expect(events).toEqual([]);
  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'GET', url: `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1` },
  ]);
});

test('It fires opened and closed pull requests on a later poll', async () => {
  const { events } = await poll(2);
  expect(events).toEqual([
    { type: 'pull_request.opened', via: 'poll', key: '21', data: pr(21, 'Opened after the first poll') },
    {
      type: 'pull_request.closed',
      via: 'poll',
      key: '22:2099-01-01T00:00:00Z',
      data: { ...pr(22, 'Merged after the first poll'), merged: true },
    },
    {
      type: 'pull_request.closed',
      via: 'poll',
      key: '23:2099-01-01T00:00:00Z',
      data: { ...pr(23, 'Closed after the first poll'), merged: false },
    },
  ]);
});

test('It fires no edit when nothing about a pull request changed between polls', async () => {
  const { events } = await poll(3);
  expect(events.map((event: { type: string }) => event.type)).not.toContain('pull_request.edited');
});
