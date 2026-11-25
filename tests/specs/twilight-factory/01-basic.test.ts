import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), ...args], { encoding: 'utf8' })).stdout.trim();

const { version } = JSON.parse(readFileSync(path.join(cli[1], '../../package.json'), 'utf8'));

test('It shows version', async () => {
  expect(await tf('--version')).toEqual(version);
});

test('It shows help', async () => {
  expect(await tf('--help')).toContain('Usage: tf');
});

test('It starts in a coding agent interface', async ({ terminal }) => {
  const term = terminal(cli.join(' '));
  await expectTerminal(term.getByText('claude-opus-5-5')).toBeVisible();
});
