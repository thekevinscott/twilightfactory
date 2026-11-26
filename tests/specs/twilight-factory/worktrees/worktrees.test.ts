import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=tf', '-c', 'user.email=tf@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

// A repo whose origin/main already holds each branch's commit, as after a fetch of the merged PR.
const repoWith = (...branches: string[]) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'tf-worktrees-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/thekevinscott/twilightfactory.git');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const branch of branches) {
    git(repo, 'worktree', 'add', '-q', `.worktrees/${branch}`, '-b', branch, 'origin/main');
    git(path.join(repo, '.worktrees', branch), 'commit', '-q', '--allow-empty', '-m', branch);
    git(repo, 'update-ref', 'refs/remotes/origin/main', branch);
  }
  return repo;
};

const hasBranch = (repo: string, branch: string) => git(repo, 'branch', '--list', branch) !== '';

// Points main's upstream at a local bare repo one commit ahead, so `git pull` works without a network.
const upstreamAhead = (repo: string) => {
  const bare = mkdtempSync(path.join(tmpdir(), 'tf-upstream-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'push', '-q', bare, 'main');
  const clone = mkdtempSync(path.join(tmpdir(), 'tf-clone-'));
  git(clone, 'clone', '-q', bare, '.');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'merged upstream');
  git(clone, 'push', '-q', 'origin', 'main');
  git(repo, 'config', 'branch.main.remote', bare);
  git(repo, 'config', 'branch.main.merge', 'refs/heads/main');
  return git(clone, 'rev-parse', '--short', 'HEAD');
};

const startIn = (terminal: Parameters<typeof startTf>[0], repo: string, fixture = 'worktrees/closed') =>
  startTf(terminal, { fixture, cwd: repo, cols: 160, env: { GH_TOKEN: 'gho_worktrees', TF_POLL_MS: '50' } }).term;

test('It removes the worktree and branch of a merged pull request', async ({ terminal }) => {
  const repo = repoWith('merged');
  await waitForStatus(startIn(terminal, repo), '#44 merged: removed .worktrees/merged and branch merged');
  expect(existsSync(path.join(repo, '.worktrees/merged'))).toBe(false);
  expect(hasBranch(repo, 'merged')).toBe(false);
});

test('It removes the worktree and branch of a pull request closed without merging', async ({ terminal }) => {
  const repo = repoWith('unmerged');
  await waitForStatus(startIn(terminal, repo), '#41 closed: removed .worktrees/unmerged and branch unmerged');
  expect(existsSync(path.join(repo, '.worktrees/unmerged'))).toBe(false);
  expect(hasBranch(repo, 'unmerged')).toBe(false);
});

test('It removes at startup a worktree whose pushed branch is merged into main', async ({ terminal }) => {
  const repo = repoWith('old');
  git(repo, 'update-ref', 'refs/remotes/origin/old', 'old');
  await waitForStatus(startIn(terminal, repo, 'worktrees/none'), 'old merged into main: removed .worktrees/old and branch old');
  expect(existsSync(path.join(repo, '.worktrees/old'))).toBe(false);
  expect(hasBranch(repo, 'old')).toBe(false);
});

test('It keeps a new worktree that has not been pushed', async ({ terminal }) => {
  const repo = repoWith('old');
  git(repo, 'update-ref', 'refs/remotes/origin/old', 'old');
  git(repo, 'worktree', 'add', '-q', '.worktrees/fresh', '-b', 'fresh', 'origin/main');
  await waitForStatus(startIn(terminal, repo, 'worktrees/none'), 'old merged into main: removed .worktrees/old');
  expect(existsSync(path.join(repo, '.worktrees/fresh'))).toBe(true);
  expect(hasBranch(repo, 'fresh')).toBe(true);
});

test('It fast-forwards main when a pull request merges', async ({ terminal }) => {
  const repo = repoWith();
  const sha = upstreamAhead(repo);
  await waitForStatus(startIn(terminal, repo), `tf: pulled main to ${sha}`);
  expect(git(repo, 'rev-parse', '--short', 'main')).toBe(sha);
});

test('It leaves main alone when it has uncommitted changes', async ({ terminal }) => {
  const repo = repoWith();
  writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-q', '-m', 'tracked');
  const before = git(repo, 'rev-parse', 'main');
  upstreamAhead(repo);
  writeFileSync(path.join(repo, 'tracked.txt'), 'two\n');
  await waitForStatus(startIn(terminal, repo), 'tf: did not pull main: uncommitted changes');
  expect(git(repo, 'rev-parse', 'main')).toBe(before);
});

test('It leaves the checkout alone when it is not on main', async ({ terminal }) => {
  const repo = repoWith();
  upstreamAhead(repo);
  git(repo, 'checkout', '-q', '-b', 'elsewhere');
  await waitForStatus(startIn(terminal, repo), 'tf: did not pull main: the checkout is on elsewhere');
});

test('It keeps the worktree of a merged pull request with uncommitted changes', async ({ terminal }) => {
  const repo = repoWith('dirty');
  writeFileSync(path.join(repo, '.worktrees/dirty/notes.txt'), 'work in progress\n');
  await waitForStatus(startIn(terminal, repo), '#42 merged: kept .worktrees/dirty: uncommitted changes');
  expect(existsSync(path.join(repo, '.worktrees/dirty/notes.txt'))).toBe(true);
  expect(hasBranch(repo, 'dirty')).toBe(true);
});

test('It keeps the worktree of a merged pull request while a process runs in it', async ({ terminal, onTestFinished }) => {
  const repo = repoWith('busy');
  const busy = spawn('sleep', ['600'], { cwd: path.join(repo, '.worktrees/busy') });
  onTestFinished(() => void busy.kill());
  await waitForStatus(startIn(terminal, repo), `#43 merged: kept .worktrees/busy: a process is running in it (pid ${busy.pid})`);
  expect(existsSync(path.join(repo, '.worktrees/busy'))).toBe(true);
});
