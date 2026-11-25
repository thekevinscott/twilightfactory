import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const tokensSent = (log: string) => requestLog(log).map(request => request.authorization).filter(Boolean);

const newConfig = () => mkdtempSync(path.join(tmpdir(), 'tf-config-'));
const ghLoggedOut = () => mkdtempSync(path.join(tmpdir(), 'tf-gh-'));
const ghLoggedIn = path.resolve('tests/fixtures/token/gh-logged-in');

const start = (terminal, { fixture, config = newConfig(), env = {} }: { fixture: string; config?: string; env?: Record<string, string> }) =>
  startTf(terminal, {
    fixture: `token/${fixture}`,
    env: { XDG_CONFIG_HOME: config, GH_CONFIG_DIR: ghLoggedOut(), TF_GITHUB_CLIENT_ID: 'Iv1.fixtureclientid', ...env },
  });

const signedInToken = 'gho_signedin0000000000000000000000000000';

test('It uses the token from GH_TOKEN', async ({ terminal }) => {
  const { term, log } = start(terminal, { fixture: 'empty-runs', env: { GH_TOKEN: 'gho_fromenv' } });
  await waitForStatus(term, /🔵\s+tests due/);
  expect(tokensSent(log)).toEqual(expect.arrayContaining([expect.stringContaining('gho_fromenv')]));
});

test("It uses gh's token when the environment has none", async ({ terminal }) => {
  const { term, log } = start(terminal, { fixture: 'empty-runs', env: { GH_CONFIG_DIR: ghLoggedIn } });
  await waitForStatus(term, /🔵\s+tests due/);
  expect(tokensSent(log)).toEqual(expect.arrayContaining([expect.stringContaining('gho_fromgh')]));
});

test('It asks to sign in when there is no token and gh is logged out', async ({ terminal }) => {
  const { term } = start(terminal, { fixture: 'sign-in-pending' });
  await expectTerminal(term.getByText('WDJB-MJHT')).toBeVisible();
  await expectTerminal(term.getByText('https://github.com/login/device')).toBeVisible();
});

test('It saves the signed-in token and reuses it on the next start', async ({ terminal }) => {
  const config = newConfig();
  const first = start(terminal, { fixture: 'sign-in', config });
  await waitForStatus(first.term, /🔵\s+tests due/);
  expect(tokensSent(first.log)).toEqual(expect.arrayContaining([expect.stringContaining(signedInToken)]));

  const saved = readdirSync(path.join(config, 'twilightfactory'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));
  expect(saved.join('\n')).toContain(signedInToken);

  const second = start(terminal, { fixture: 'empty-runs', config });
  await waitForStatus(second.term, /🔵\s+tests due/);
  await expectTerminal(second.term.getByText('https://github.com/login/device')).notToBeVisible();
  expect(tokensSent(second.log)).toEqual(expect.arrayContaining([expect.stringContaining(signedInToken)]));
});
