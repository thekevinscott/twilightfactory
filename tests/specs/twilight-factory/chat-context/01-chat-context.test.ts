import { fileURLToPath } from 'node:url';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const session = fileURLToPath(new URL('./session.mjs', import.meta.url));

const chat = (terminal, ...tools: string[]) =>
  terminal(['node', session, ...tools].join(' '), { cols: 300, env: { ...proxyEnv('chat-context/repo'), GH_TOKEN: 'gho_chat' } });

test('It registers the tf tools', async ({ terminal }) => {
  const term = chat(terminal);
  await expectTerminal(term.getByText('TOOLS tf_state tf_pull_requests tf_issues tf_ci_runs')).toBeVisible();
});

test('It tells the chat what tf is and which repository it runs on', async ({ terminal }) => {
  const term = chat(terminal);
  await expectTerminal(term.getByText('runs inside tf (twilight factory)')).toBeVisible();
  await expectTerminal(term.getByText('GitHub repository: thekevinscott/twilightfactory')).toBeVisible();
  await expectTerminal(term.getByText(`Project directory: ${process.cwd()}`)).toBeVisible();
});

test('It lists open and recently closed pull requests, one per line', async ({ terminal }) => {
  const term = chat(terminal, 'tf_pull_requests');
  await expectTerminal(term.getByText('#101 open "Open fixture pull request" by thekevinbot from fixture-open')).toBeVisible();
  await expectTerminal(term.getByText('#102 open draft "Draft fixture pull request"')).toBeVisible();
  await expectTerminal(term.getByText('#100 merged "Merged fixture pull request"')).toBeVisible();
});

test('It lists open issues without pull requests', async ({ terminal }) => {
  const term = chat(terminal, 'tf_issues');
  await expectTerminal(term.getByText('#55 "Fixture issue" [red] https://github.com/thekevinscott/twilightfactory/issues/55')).toBeVisible();
  await expectTerminal(term.getByText('RESULT tf_issues')).toBeVisible();
  await expectTerminal(term.getByText('#101 "Open fixture pull request"')).notToBeVisible();
});

test('It lists recent test runs on main', async ({ terminal }) => {
  const term = chat(terminal, 'tf_ci_runs');
  await expectTerminal(term.getByText('plain in_progress 1234567 2026-11-24T11:00:00Z')).toBeVisible();
  await expectTerminal(term.getByText('measured completed failure abcdef0 2026-11-24T10:00:00Z')).toBeVisible();
});
