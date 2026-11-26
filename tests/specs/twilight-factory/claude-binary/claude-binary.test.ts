import { accessSync, constants, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// pi-claude-bridge logs its loaded config at startup when CLAUDE_BRIDGE_DEBUG=1.
const bridgeConfig = (log: string) => {
  const line = readFileSync(log, 'utf8').split('\n').find(l => l.includes('loadConfig:'))!;
  return JSON.parse(line.slice(line.indexOf('loadConfig:') + 'loadConfig:'.length));
};

test("It runs Claude from a copy of the binary that a node_modules reinstall can't remove", async ({ terminal }) => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bridge-')), 'bridge.log');
  const { term } = startTf(terminal, {
    fixture: 'state/tests-due',
    env: { GH_TOKEN: 'gho_claude_binary', CLAUDE_BRIDGE_DEBUG: '1', CLAUDE_BRIDGE_DEBUG_PATH: log },
  });
  // The bridge loads its config before Pi draws the footer.
  await waitForStatus(term, /🔵\s+tests due/);
  const executable = bridgeConfig(log).provider.pathToClaudeCodeExecutable;
  expect(executable).toEqual(expect.any(String));
  expect(executable).not.toContain('node_modules');
  accessSync(executable, constants.X_OK);
});
