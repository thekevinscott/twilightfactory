import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'curtaincall/vitest';

const shows = (terminal, fixture: string, status: RegExp, env: Record<string, string> = { GH_TOKEN: 'gho_footer' }) =>
  waitForStatus(startTf(terminal, { fixture, env }).term, status);

test('It has never run', ({ terminal }) => shows(terminal, 'state/tests-due', /🔵\s+tests due/));

test('It shows a white dot while a run is in progress', ({ terminal }) => shows(terminal, 'state/waiting', /⚪\s+waiting/));

test('It shows a red dot when the last run failed', ({ terminal }) => shows(terminal, 'state/red', /🔴\s+red/));

test('It shows a yellow dot when a pull request is blocked', ({ terminal }) => shows(terminal, 'state/prs-blocked', /🟡\s+PRs blocked/));

test('It shows a yellow dot while waiting for GitHub sign-in', ({ terminal }) =>
  shows(terminal, 'token/sign-in-pending', /🟡\s+sign in to GitHub/, {
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), 'tf-config-')),
    GH_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'tf-gh-')),
    TF_GITHUB_CLIENT_ID: 'Iv1.fixtureclientid',
  }));

test("It shows a red dot and the error when GitHub can't be reached", ({ terminal }) => shows(terminal, 'state/unreachable', /🔴\s+error: /));
