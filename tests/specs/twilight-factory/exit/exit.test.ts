import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const screen = (term: { getBuffer(): string[][] }) => term.getBuffer().map(row => row.join('')).join('\n');

const sessionFiles = (agentDir: string) =>
  readdirSync(agentDir, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.jsonl'));

// Pi only prints its resume hint once the session file exists, which needs a user message.
// Submits during startup are held in the editor, so Enter is pressed until one lands.
test("It doesn't tell you to resume with pi when it quits", async ({ terminal }) => {
  const agentDir = mkdtempSync(path.join(tmpdir(), 'tf-exit-'));
  const { term } = startTf(terminal, { fixture: 'state/tests-due', env: { GH_TOKEN: 'gho_exit', PI_CODING_AGENT_DIR: agentDir } });
  await expectTerminal(term.getByText('claude-opus-5-5')).toBeVisible();
  term.write('hello');
  await expect.poll(() => {
    term.keyEnter();
    return sessionFiles(agentDir).length;
  }).toBeGreaterThan(0);
  term.keyCtrlC();
  term.keyCtrlC();
  await expectTerminal(term).toHaveExited();
  expect(screen(term)).not.toContain('pi --session');
  expect(screen(term)).not.toContain('To resume this session');
});
