import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// The first poll after start fires nothing; pull requests stamped 2099 count as opened on the next one.
test('It turns on auto-merge for a pull request opened after start', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, { fixture: 'auto-merge/opened', log: requests.log, env: { GH_TOKEN: 'gho_auto_merge', TF_POLL_MS: '50' } });
  const mutation = await requests.next(
    ({ method, url, body }) => method === 'POST' && url.endsWith('/graphql') && String(body).includes('enablePullRequestAutoMerge'),
  );
  expect(JSON.parse(mutation.body as string).variables).toEqual({ pullRequestId: 'PR_node32', mergeMethod: 'MERGE' });
});
