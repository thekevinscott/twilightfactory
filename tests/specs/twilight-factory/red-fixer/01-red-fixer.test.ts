import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// The agent dir points the red-fixer subagent at a fake model served from the fixture, so no real Claude starts.
const agentDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tf-agent-'));
  cpSync(fileURLToPath(new URL('../../../fixtures/red-fixer/agent', import.meta.url)), dir, { recursive: true });
  return dir;
};

const isFixer = ({ url }: { url: string }) => url.startsWith('https://llm.fixture/');
const isRuns = ({ method, url }: { method: string; url: string }) => method === 'GET' && url.includes('/actions/workflows/tests.yml/runs');

test('It starts the red fixer once when main is red and no red issue is open', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, {
    fixture: 'red-fixer/red',
    log: requests.log,
    env: { GH_TOKEN: 'gho_red', PI_CODING_AGENT_DIR: agentDir(), TF_REFRESH_MS: '200' },
  });
  const fixer = await requests.next(isFixer);
  expect(fixer.body).toContain('https://github.com/thekevinscott/twilightfactory/actions/runs/7');
  const refreshes = requestLog(requests.log).filter(isRuns).length;
  await requests.next(() => requestLog(requests.log).filter(isRuns).length > refreshes + 1);
  expect(requestLog(requests.log).filter(isFixer)).toHaveLength(1);
});
