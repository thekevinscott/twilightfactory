import * as gh from 'twilight-gh';
import { expect, test } from 'vitest';

const repo = 'thekevinscott/twilightfactory';
const api = `https://api.github.com/repos/${repo}`;
const workflow = `${api}/actions/workflows/tests.yml`;

type Options = NonNullable<Parameters<typeof gh.client>[1]>;

const call = async <A extends unknown[], T>(
  fixture: string,
  fn: (github: ReturnType<typeof gh.client>, repo: string, ...args: A) => Promise<T>,
  args = [] as unknown[] as A,
  { token = 'gho_gh', options = {} as Options } = {},
) => {
  const session = proxySession(`gh/${fixture}`);
  const requests = () => session.requests.map(({ body, ...entry }) => ({ ...entry, body: body ? JSON.parse(body) : undefined }));
  try {
    const value = await fn(gh.client(token, { ...options, request: { fetch: session.fetch } }), repo, ...args);
    return { value: value ?? null, error: undefined, requests: requests() };
  } catch (error) {
    const { status, message } = error as { status?: number; message: string };
    return { value: undefined, error: { status: status ?? null, message }, requests: requests() };
  }
};

const run = (id: number, displayTitle: string, extra: Record<string, string> = {}) => ({
  id,
  status: 'completed',
  conclusion: 'success',
  createdAt: `2026-11-24T${id}:00:00Z`,
  headSha: 'abcdef0123456789',
  displayTitle,
  url: `https://github.com/${repo}/actions/runs/${id}`,
  ...extra,
});

test('It sends the token in the authorization header', async () => {
  const { requests } = await call('runs', gh.lastRun, [], { token: 'gho_sent' });
  expect(requests.map(request => request.authorization)).toEqual(['token gho_sent']);
});

test('It passes client options through to Octokit', async () => {
  const { requests } = await call('enterprise', gh.lastRun, [], { options: { baseUrl: 'https://ghe.example.com/api/v3' } });
  expect(requests.map(request => request.url)).toEqual([`https://ghe.example.com/api/v3/repos/${repo}/actions/workflows/tests.yml/runs?branch=main&per_page=1`]);
});

test('It returns the newest run of tests.yml on main', async () => {
  const { value, requests } = await call('runs', gh.lastRun);
  expect(value).toEqual(run(14, 'Tests (plain)', { headSha: '1414141414141414' }));
  expect(requests.map(request => request.url)).toEqual([`${workflow}/runs?branch=main&per_page=1`]);
});

test('It returns an unfinished run with an empty conclusion', async () => {
  const { value } = await call('in-progress', gh.lastRun);
  expect(value).toEqual(run(20, 'Tests (plain)', { status: 'in_progress', conclusion: '' }));
});

test('It returns no last run when tests.yml has never run', async () => {
  expect((await call('no-runs', gh.lastRun)).value).toBeNull();
});

test('It returns the newest measured run among the last 100', async () => {
  const { value, requests } = await call('runs', gh.lastMeasuredRun);
  expect(value).toEqual(run(12, 'Tests (measured)', { headSha: '1212121212121212' }));
  expect(requests.map(request => request.url)).toEqual([`${workflow}/runs?branch=main&per_page=100`]);
});

test('It returns no measured run when only plain runs exist', async () => {
  expect((await call('plain-runs', gh.lastMeasuredRun)).value).toBeNull();
});

test('It returns no measured run when tests.yml has never run', async () => {
  expect((await call('no-runs', gh.lastMeasuredRun)).value).toBeNull();
});

test('It returns the sha of HEAD', async () => {
  const { value, requests } = await call('head', gh.head);
  expect(value).toBe('feedface00112233445566778899aabbccddeeff');
  expect(requests.map(request => request.url)).toEqual([`${api}/commits/HEAD`]);
});

test('It finds an open red issue', async () => {
  const { value, requests } = await call('red-issue', gh.openRedIssue);
  expect(value).toBe(true);
  expect(requests.map(request => request.url)).toEqual([`${api}/issues?labels=red&state=open&per_page=100`]);
});

test('It ignores a pull request labeled red', async () => {
  expect((await call('red-pull-request', gh.openRedIssue)).value).toBe(false);
});

test('It reports no red issue when none is open', async () => {
  expect((await call('no-red-issue', gh.openRedIssue)).value).toBe(false);
});

test('It dispatches tests.yml on main with the kind', async () => {
  const { value, error, requests } = await call('dispatch', gh.startRun, ['measured']);
  expect(error).toBeUndefined();
  expect(value).toBeNull();
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'measured' } } },
  ]);
});

test('It files a red issue for a failed run', async () => {
  const failed = run(42, 'Tests (plain)', { conclusion: 'failure' });
  const { error, requests } = await call('file-issue', gh.fileIssue, [failed]);
  expect(error).toBeUndefined();
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    {
      method: 'POST',
      url: `${api}/issues`,
      body: { labels: ['red'], title: 'main is red at abcdef0', body: `Tests (plain) failed: https://github.com/${repo}/actions/runs/42` },
    },
  ]);
});

test('It confirms a fix with a measured run when the newest red run was measured', async () => {
  const { value, requests } = await call('red-measured', gh.confirmFix);
  expect(value).toBe('measured');
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: 'GET', url: `${workflow}/runs?branch=main&per_page=100`, body: undefined },
    { method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'measured' } } },
  ]);
});

test('It confirms a fix with a plain run when the newest red run was plain', async () => {
  const { value, requests } = await call('red-plain', gh.confirmFix);
  expect(value).toBe('plain');
  expect(requests.at(-1)).toMatchObject({ method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'plain' } } });
});

test('It refuses to confirm a fix when no run is red', async () => {
  const { value, error, requests } = await call('no-red', gh.confirmFix);
  expect(value).toBeUndefined();
  expect(error.message).toBe(`no red run of tests.yml on main in ${repo}`);
  expect(requests.map(request => request.method)).toEqual(['GET']);
});
