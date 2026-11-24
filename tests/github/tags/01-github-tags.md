<data name="fixture">tests/fixtures/three-green-tags-newest-first</data>

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from 'vitest';
if (process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = process.env.HTTPS_PROXY.replace('//', `//${encodeURIComponent(fixture)}@`);
const tf = async (...args: string[]) => (await promisify(execFile)(cli[0], [...cli.slice(1), 'gh', 'tags', ...args], { encoding: 'utf8' })).stdout.trim();
```

# It shows help

```typescript
test(title, async () => {
  expect(await tf('--help')).toContain('Usage: tf gh tags');
});
```

# It lists recent green tags, newest first

```typescript
test(title, async () => {
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/green/", first: 10, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes { name target { ... on Commit { oid committedDate } ... on Tag { target { ... on Commit { oid committedDate } } } } }
    }
  } }`;
  const fetchTags = async () => (await promisify(execFile)('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'name={repo}'])).stdout;
  const fetchLines = async () => (await tf()).split('\n').filter(Boolean).map(line => line.split(/ {2,}/));
  const [lines, tags] = await Promise.all([fetchLines(), fetchTags()]);
  expect(lines).toEqual(JSON.parse(tags).data.repository.refs.nodes.map(({ name, target }) => {
    const commit = target.target ?? target;
    return [`green/${name}`, commit.committedDate, commit.oid];
  }));
});
```
