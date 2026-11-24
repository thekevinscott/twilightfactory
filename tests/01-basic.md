```typescript
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';
const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), ...args], { encoding: 'utf8' })).stdout.trim();
```

<data name="version">

```typescript
const { version } = JSON.parse(readFileSync(path.join(cli[1], '../../package.json'), 'utf8'));
version
```

</data>

# It shows version

```typescript
test(title, async () => {
  expect(await tf('--version')).toEqual(version);
});
```


# It shows help

```typescript
test(title, async () => {
  expect(await tf('--help')).toContain('Usage: tf');
});
```

# It starts in a coding agent interface

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '));
  await expectTerminal(term.getByText('Pi can explain its own features')).toBeVisible();
});
```
