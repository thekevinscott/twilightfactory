import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const repo = 'thekevinscott/twilightfactory';
const api = `https://api.github.com/repos/${repo}`;
const workflow = `${api}/actions/workflows/tests.yml`;

// Node reads HTTPS_PROXY once at startup, so each call runs in its own process to pick its fixture.
const script = `
const [module, fn, token, repo, args, options] = process.argv.slice(1);
const gh = await import(module);
try {
  const value = await gh[fn](gh.client(token, JSON.parse(options)), repo, ...JSON.parse(args));
  console.log(JSON.stringify({ value: value ?? null }));
} catch (error) {
  console.log(JSON.stringify({ error: { status: error.status ?? null, message: error.message } }));
}`;

const call = async (fixture: string, fn: string, args: unknown[] = [], { token = 'gho_gh', options = {} } = {}) => {
  const log = randomUUID().replaceAll('-', '');
  const { stdout } = await promisify(execFile)(
    'node',
    ['--input-type=module', '-e', script, path.resolve('packages/gh/dist/index.js'), fn, token, repo, JSON.stringify(args), JSON.stringify(options)],
    { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: `http://${encodeURIComponent(`tests/fixtures/gh/${fixture}`)}:${log}@proxy:8080` } },
  );
  return { ...JSON.parse(stdout), requests: requests(log) };
};

const requests = (log: string) => {
  const file = path.join(process.env.PROXY_REQUESTS!, `${log}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').map(line => {
    const { body, ...entry } = JSON.parse(line);
    return body ? { ...entry, body: JSON.parse(body) } : entry;
  });
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
  const { requests } = await call('workflow', 'hasWorkflow', [], { token: 'gho_sent' });
  expect(requests.map(request => request.authorization)).toEqual(['token gho_sent']);
});

test('It passes client options through to Octokit', async () => {
  const { value, requests } = await call('enterprise', 'hasWorkflow', [], { options: { baseUrl: 'https://ghe.example.com/api/v3' } });
  expect(value).toBe(true);
  expect(requests.map(request => request.url)).toEqual([`https://ghe.example.com/api/v3/repos/${repo}/actions/workflows/tests.yml`]);
});

test('It finds the tests workflow', async () => {
  const { value, requests } = await call('workflow', 'hasWorkflow');
  expect(value).toBe(true);
  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([{ method: 'GET', url: workflow }]);
});

test('It reports no tests workflow when GitHub answers 404', async () => {
  expect((await call('no-workflow', 'hasWorkflow')).value).toBe(false);
});

test('It throws when GitHub fails to look up the workflow', async () => {
  const { value, error } = await call('workflow-error', 'hasWorkflow');
  expect(value).toBeUndefined();
  expect(error.status).toBe(500);
});

test('It returns the newest run of tests.yml on main', async () => {
  const { value, requests } = await call('runs', 'lastRun');
  expect(value).toEqual(run(14, 'Tests (plain)', { headSha: '1414141414141414' }));
  expect(requests.map(request => request.url)).toEqual([`${workflow}/runs?branch=main&per_page=1`]);
});

test('It returns an unfinished run with an empty conclusion', async () => {
  const { value } = await call('in-progress', 'lastRun');
  expect(value).toEqual(run(20, 'Tests (plain)', { status: 'in_progress', conclusion: '' }));
});

test('It returns no last run when tests.yml has never run', async () => {
  expect((await call('no-runs', 'lastRun')).value).toBeNull();
});

test('It returns the newest measured run among the last 100', async () => {
  const { value, requests } = await call('runs', 'lastMeasuredRun');
  expect(value).toEqual(run(12, 'Tests (measured)', { headSha: '1212121212121212' }));
  expect(requests.map(request => request.url)).toEqual([`${workflow}/runs?branch=main&per_page=100`]);
});

test('It returns no measured run when only plain runs exist', async () => {
  expect((await call('plain-runs', 'lastMeasuredRun')).value).toBeNull();
});

test('It returns no measured run when tests.yml has never run', async () => {
  expect((await call('no-runs', 'lastMeasuredRun')).value).toBeNull();
});

test('It returns the sha of HEAD', async () => {
  const { value, requests } = await call('head', 'head');
  expect(value).toBe('feedface00112233445566778899aabbccddeeff');
  expect(requests.map(request => request.url)).toEqual([`${api}/commits/HEAD`]);
});

test('It finds an open red issue', async () => {
  const { value, requests } = await call('red-issue', 'openRedIssue');
  expect(value).toBe(true);
  expect(requests.map(request => request.url)).toEqual([`${api}/issues?labels=red&state=open&per_page=100`]);
});

test('It ignores a pull request labeled red', async () => {
  expect((await call('red-pull-request', 'openRedIssue')).value).toBe(false);
});

test('It reports no red issue when none is open', async () => {
  expect((await call('no-red-issue', 'openRedIssue')).value).toBe(false);
});

test('It asks GraphQL for the open pull requests of the repo', async () => {
  const { requests } = await call('blocked', 'blockedPullRequests');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: 'POST', url: 'https://api.github.com/graphql' });
  expect(requests[0].body.variables).toEqual({ owner: 'thekevinscott', repo: 'twilightfactory' });
  expect(requests[0].body.query).toContain('pullRequests(states: OPEN');
});

test('It reports a pull request whose Main is green check failed, with the run id', async () => {
  const { value } = await call('blocked', 'blockedPullRequests');
  expect(value).toContainEqual({ number: 1, runId: 101 });
  expect(value).toContainEqual({ number: 6, runId: 601 });
});

test('It ignores pull requests that Main is green does not block', async () => {
  const { value } = await call('blocked', 'blockedPullRequests');
  expect(value.map(pr => pr.number)).not.toContain(2);
  expect(value.map(pr => pr.number)).not.toContain(3);
});

test('It ignores pull requests with no checks or no commits', async () => {
  const { value } = await call('blocked', 'blockedPullRequests');
  expect(value).toEqual([{ number: 1, runId: 101 }, { number: 6, runId: 601 }]);
});

test('It dispatches tests.yml on main with the kind', async () => {
  const { value, error, requests } = await call('dispatch', 'startRun', ['measured']);
  expect(error).toBeUndefined();
  expect(value).toBeNull();
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'measured' } } },
  ]);
});

test('It files a red issue for a failed run', async () => {
  const failed = run(42, 'Tests (plain)', { conclusion: 'failure' });
  const { error, requests } = await call('file-issue', 'fileIssue', [failed]);
  expect(error).toBeUndefined();
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    {
      method: 'POST',
      url: `${api}/issues`,
      body: { labels: ['red'], title: 'main is red at abcdef0', body: `Tests (plain) failed: https://github.com/${repo}/actions/runs/42` },
    },
  ]);
});

test('It reruns the failed jobs of a check', async () => {
  const { error, requests } = await call('rerun', 'rerunCheck', [4242]);
  expect(error).toBeUndefined();
  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([{ method: 'POST', url: `${api}/actions/runs/4242/rerun-failed-jobs` }]);
});

test('It confirms a fix with a measured run when the newest red run was measured', async () => {
  const { value, requests } = await call('red-measured', 'confirmFix');
  expect(value).toBe('measured');
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: 'GET', url: `${workflow}/runs?branch=main&per_page=100`, body: undefined },
    { method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'measured' } } },
  ]);
});

test('It confirms a fix with a plain run when the newest red run was plain', async () => {
  const { value, requests } = await call('red-plain', 'confirmFix');
  expect(value).toBe('plain');
  expect(requests.at(-1)).toMatchObject({ method: 'POST', url: `${workflow}/dispatches`, body: { ref: 'main', inputs: { kind: 'plain' } } });
});

test('It refuses to confirm a fix when no run is red', async () => {
  const { value, error, requests } = await call('no-red', 'confirmFix');
  expect(value).toBeUndefined();
  expect(error.message).toBe(`no red run of tests.yml on main in ${repo}`);
  expect(requests.map(request => request.method)).toEqual(['GET']);
});
