import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

test('tf context prints the context doc', async () => {
  const { stdout } = await promisify(execFile)(cli[0], [...cli.slice(1), 'context'], { encoding: 'utf8' });
  expect(stdout).toContain('# Twilight Factory');
  expect(stdout).toEqual(readFileSync(path.join(cli[1], '../../docs/context.md'), 'utf8'));
});
