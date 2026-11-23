# It shows the watched branch

## CLI

### Typescript

```typescript
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';

test('It shows the watched branch', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'tf-test-'));
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  const env = { ...process.env, XDG_STATE_HOME: path.join(folder, 'state'), XDG_RUNTIME_DIR: folder };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const tf = (...args: string[]) => execFileSync(cli[0], [...cli.slice(1), ...args], { cwd: work, env, encoding: 'utf8' });

  git(folder, 'init', '--bare', '--initial-branch=main', remote);
  git(folder, 'clone', remote, work);
  git(work, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'first');
  git(work, 'push', 'origin', 'HEAD:main');
  const head = git(work, 'rev-parse', '--short', 'HEAD');

  try {
    expect(tf('status')).toContain(`origin/main ${head}`);
  } finally {
    tf('stop');
  }
});
```
