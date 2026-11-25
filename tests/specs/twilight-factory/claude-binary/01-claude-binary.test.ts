import { accessSync, constants, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// pi-claude-bridge logs its loaded config at startup when CLAUDE_BRIDGE_DEBUG=1.
const bridgeConfig = (log: string) => {
  const line = existsSync(log) && readFileSync(log, 'utf8').split('\n').find(l => l.includes('loadConfig:'));
  return line ? JSON.parse(line.slice(line.indexOf('loadConfig:') + 'loadConfig:'.length)) : undefined;
};

test("It runs Claude from a copy of the binary that a node_modules reinstall can't remove", async ({ terminal }) => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bridge-')), 'bridge.log');
  startTf(terminal, {
    fixture: 'state/tests-due',
    env: { GH_TOKEN: 'gho_claude_binary', CLAUDE_BRIDGE_DEBUG: '1', CLAUDE_BRIDGE_DEBUG_PATH: log },
  });
  await expect.poll(() => bridgeConfig(log)).toBeDefined();
  const executable = bridgeConfig(log).provider.pathToClaudeCodeExecutable;
  expect(executable).toEqual(expect.any(String));
  expect(executable).not.toContain('node_modules');
  accessSync(executable, constants.X_OK);
});
