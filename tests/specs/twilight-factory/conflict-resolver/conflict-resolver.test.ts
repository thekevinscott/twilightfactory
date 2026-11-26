import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// The agent dir points the conflict-resolver subagent at a fake model served from the fixture, so no real Claude starts.
const agentDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tf-agent-'));
  cpSync(fileURLToPath(new URL('../../../fixtures/conflict-resolver/agent', import.meta.url)), dir, { recursive: true });
  return dir;
};

const isResolver = ({ url }: { url: string }) => url.startsWith('https://llm.fixture/');
const isConflictCheck = ({ method, url }: { method: string; url: string }) => method === 'GET' && url.endsWith('/pulls/41');

test('It starts one conflict resolver for a conflicted pull request that is not a draft', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, {
    fixture: 'conflict-resolver/conflicted',
    log: requests.log,
    env: { GH_TOKEN: 'gho_conflict', PI_CODING_AGENT_DIR: agentDir(), TF_POLL_MS: '50' },
  });
  const resolver = await requests.next(isResolver);
  expect(resolver.body).toContain('https://github.com/thekevinscott/twilightfactory/pull/41');
  const checks = requestLog(requests.log).filter(isConflictCheck).length;
  await requests.next(() => requestLog(requests.log).filter(isConflictCheck).length > checks + 1);
  const resolvers = requestLog(requests.log).filter(isResolver);
  expect(resolvers).toHaveLength(1);
  expect(String(resolvers[0]!.body)).not.toMatch(/pull\/4[23]\b/);
});
