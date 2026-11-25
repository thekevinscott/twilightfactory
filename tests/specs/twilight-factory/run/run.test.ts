import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

// The fixture's measured run is dated 2099 so it always counts as within the last day.
test('It starts a plain run on main when a plain run is due', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, { fixture: 'run/go-plain', log: requests.log, env: { GH_TOKEN: 'gho_run' } });
  const dispatch = await requests.next(({ method, url }) => method === 'POST' && url.endsWith('/actions/workflows/tests.yml/dispatches'));
  expect(JSON.parse(dispatch.body as string)).toEqual({ ref: 'main', inputs: { kind: 'plain' } });
});

test('It starts a measured run on main when main has no runs', async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, { fixture: 'run/go-measured', log: requests.log, env: { GH_TOKEN: 'gho_run' } });
  const dispatch = await requests.next(({ method, url }) => method === 'POST' && url.endsWith('/actions/workflows/tests.yml/dispatches'));
  expect(JSON.parse(dispatch.body as string)).toEqual({ ref: 'main', inputs: { kind: 'measured' } });
});
