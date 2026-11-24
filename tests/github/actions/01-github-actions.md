<data name="fixture">tests/fixtures/two-passing-runs-one-failing</data>

```typescript
import { exec as execWithCallback, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
if (process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = process.env.HTTPS_PROXY.replace('//', `//${encodeURIComponent(fixture)}@`);
const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), 'gh', 'actions', ...args], { encoding: 'utf8' })).stdout.trim();
const exec = async (command: string) => (await promisify(execWithCallback)(command)).stdout;
```

# It shows help

```typescript
test(title, async () => {
  expect(await tf('--help')).toContain('Usage: tf gh actions');
});
```

# It lists recent actions

```typescript
test(title, async () => {
  const fetchRuns = () => exec('gh run list --limit 10 --json status,conclusion,workflowName,headBranch,createdAt,displayTitle');
  const fetchLines = async () => (await tf()).split('\n').map(line => line.split(/ {2,}/));
  const [lines, runs] = await Promise.all([fetchLines(), fetchRuns()]);
  expect(lines).toEqual(JSON.parse(runs).map(run => [
    run.conclusion || run.status,
    run.workflowName,
    run.headBranch,
    run.createdAt,
    run.displayTitle,
  ]));
});
```
