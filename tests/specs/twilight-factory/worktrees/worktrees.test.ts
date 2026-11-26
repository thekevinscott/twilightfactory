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

const startIn = (terminal: Parameters<typeof startTf>[0], repo: string) =>
  startTf(terminal, { fixture: 'worktrees/closed', cwd: repo, cols: 160, env: { GH_TOKEN: 'gho_worktrees', TF_POLL_MS: '50' } }).term;

test('It removes the worktree and branch of a merged pull request', async ({ terminal }) => {
  const repo = repoWith('merged');
  await waitForStatus(startIn(terminal, repo), '#44 merged: removed .worktrees/merged and branch merged');
  expect(existsSync(path.join(repo, '.worktrees/merged'))).toBe(false);
  expect(hasBranch(repo, 'merged')).toBe(false);
});

test('It leaves the worktree of a pull request closed without merging', async ({ terminal }) => {
  const repo = repoWith('unmerged', 'merged');
  await waitForStatus(startIn(terminal, repo), '#44 merged: removed .worktrees/merged');
  expect(existsSync(path.join(repo, '.worktrees/unmerged'))).toBe(true);
  expect(hasBranch(repo, 'unmerged')).toBe(true);
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
