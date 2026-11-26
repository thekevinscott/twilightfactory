import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

const isDispatch = ({ method, url }: { method: string; url: string }) =>
  method === 'POST' && url.endsWith('/actions/workflows/tests.yml/dispatches');

// A throwaway key made for this run; the proxy never checks the signature.
const appConfig = ({ key = true } = {}) => {
  const config = mkdtempSync(path.join(tmpdir(), 'tf-config-'));
  const dir = path.join(config, 'twilightfactory');
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'github-app.json'), JSON.stringify({ appId: 123, installationId: 456 }));
  if (key) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    writeFileSync(path.join(dir, 'github-app.pem'), privateKey);
  }
  return config;
};

test('It starts runs as the GitHub App when one is configured', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, { fixture: 'run/go-plain-app', log: requests.log, env: { GH_TOKEN: 'gho_run', XDG_CONFIG_HOME: appConfig() } });
  const dispatch = await requests.next(isDispatch);
  expect(dispatch.authorization).toBe('token ghs_fromapp');
  const reads = requestLog(requests.log).filter(({ method, url }) => method === 'GET' && url.includes('api.github.com/repos/'));
  expect(reads.map(request => request.authorization)).toEqual(reads.map(() => 'token gho_run'));
});

test('It starts runs with the user token when no app is configured', async ({ terminal }) => {
  const requests = await proxyRequests();
  const config = mkdtempSync(path.join(tmpdir(), 'tf-config-'));
  startTf(terminal, { fixture: 'run/go-plain-app', log: requests.log, env: { GH_TOKEN: 'gho_run', XDG_CONFIG_HOME: config } });
  const dispatch = await requests.next(isDispatch);
  expect(dispatch.authorization).toBe('token gho_run');
});

test('It shows an error instead of falling back when the app config is broken', async ({ terminal }) => {
  const requests = await proxyRequests();
  const { term } = startTf(terminal, {
    fixture: 'run/go-plain-app',
    log: requests.log,
    env: { GH_TOKEN: 'gho_run', XDG_CONFIG_HOME: appConfig({ key: false }) },
  });
  await waitForStatus(term, /can't read the GitHub App key/);
  expect(requestLog(requests.log).filter(isDispatch)).toEqual([]);
});
