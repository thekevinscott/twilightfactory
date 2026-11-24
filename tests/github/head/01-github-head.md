<data name="fixture">tests/fixtures/head-commit-of-default-branch</data>

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
if (process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = process.env.HTTPS_PROXY.replace('//', `//${encodeURIComponent(fixture)}@`);
const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), 'gh', 'head', ...args], { encoding: 'utf8' })).stdout.trim();
```

# It shows help

```typescript
test(title, async () => {
  expect(await tf('--help')).toContain('Usage: tf gh head');
});
```

# It shows the head commit of the default branch

```typescript
test(title, async () => {
  const fetchHead = async () => (await promisify(execFile)('gh', ['api', 'repos/{owner}/{repo}/commits/HEAD', '--jq', '.sha'])).stdout.trim();
  const [head, expected] = await Promise.all([tf(), fetchHead()]);
  expect(head).toMatch(/^[0-9a-f]{40}$/);
  expect(head).toBe(expected);
});
```
