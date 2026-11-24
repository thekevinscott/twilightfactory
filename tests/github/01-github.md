```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), 'gh', ...args], { encoding: 'utf8' })).stdout.trim();
```

# It shows help

```typescript
test(title, async () => {
  expect(await tf('--help')).toContain('Usage: tf gh');
});
```
