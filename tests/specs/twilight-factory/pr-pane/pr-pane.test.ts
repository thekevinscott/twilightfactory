import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';
import { expect } from 'vitest';

// The fixture has two open pull requests and seven closed ones, listed in an order unlike their close times.
const pane = (terminal) => startTf(terminal, { fixture: 'pr-pane/recent', env: { GH_TOKEN: 'gho_pane' }, cols: 120, rows: 40 }).term;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=tf', '-c', 'user.email=tf@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

// #85 closes after tf starts, and its worktree's commit is already on origin/main, so tf removes it and says so.
const repoWithMergedWorktree = () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'tf-pr-pane-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/thekevinscott/twilightfactory.git');
  git(repo, 'worktree', 'add', '-q', '.worktrees/branch-85', '-b', 'branch-85', 'HEAD');
  git(path.join(repo, '.worktrees/branch-85'), 'commit', '-q', '--allow-empty', '-m', 'branch-85');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'branch-85');
  return repo;
};

test('It shows every open pull request in a pane at the top', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#91\s+open\s+Open and in review/)).toBeVisible();
  await expectTerminal(term.getByText(/#90\s+open\s+Open since last week/)).toBeVisible();
});

test('It shows the 5 most recently closed pull requests, merged or not', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#88\s+closed\s+Closed on the 23rd/)).toBeVisible();
  await expectTerminal(term.getByText(/#85\s+merged\s+Merged on the 22nd/)).toBeVisible();
  await expectTerminal(term.getByText(/#87\s+merged\s+Merged on the 21st/)).toBeVisible();
  await expectTerminal(term.getByText(/#89\s+merged\s+Merged on the 20th/)).toBeVisible();
  await expectTerminal(term.getByText(/#83\s+merged\s+Merged on the 19th/)).toBeVisible();
  await expectTerminal(term.getByText('Merged on the 3rd')).notToBeVisible();
  await expectTerminal(term.getByText('Closed on the 4th')).notToBeVisible();
});

test('It keeps chat below the pane, so a notice is not covered', async ({ terminal }) => {
  const { term } = startTf(terminal, {
    fixture: 'pr-pane/notice',
    cwd: repoWithMergedWorktree(),
    env: { GH_TOKEN: 'gho_pane', TF_POLL_MS: '50' },
    cols: 120,
  });
  await expectTerminal(term.getByText(/#91\s+open\s+Open and in review/)).toBeVisible();
  await expectTerminal(term.getByText('tf: #85 merged: removed .worktrees/branch-85')).toBeVisible();
});

// The tall fixture has 40 open pull requests, #140 down to #101. Below the pane: 20 rows of chat, the input box (3) and the footer (1).
const tallPane = async (terminal, rows: number) => {
  const { term } = startTf(terminal, { fixture: 'pr-pane/tall', env: { GH_TOKEN: 'gho_pane' }, cols: 100, rows });
  await expectTerminal(term.getByText(/#140\s+open/)).toBeVisible();
  return term;
};
const line = (term, row: number) => term.getViewableBuffer()[row].join('');

test('It gives the pane the rows left after 20 rows of chat, folding the rest into +N more', async ({ terminal }) => {
  const term = await tallPane(terminal, 40);
  await expectTerminal(term.getByText('+26 more')).toBeVisible();
  expect(line(term, 13)).toMatch(/#127\s+open/);
  expect(line(term, 14)).toMatch(/\+26 more/);
  expect(line(term, 15)).toMatch(/^─+$/);
});

test('It shrinks the pane to a few rows on a short terminal', async ({ terminal }) => {
  const term = await tallPane(terminal, 24);
  await expectTerminal(term.getByText('+38 more')).toBeVisible();
  expect(line(term, 1)).toMatch(/#139\s+open/);
  expect(line(term, 2)).toMatch(/\+38 more/);
  expect(line(term, 3)).toMatch(/^─+$/);
});
