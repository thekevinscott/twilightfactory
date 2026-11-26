import { fileURLToPath } from 'node:url';
import { expect as expectTerminal, type Terminal } from 'curtaincall';
import type { TerminalFactory } from 'curtaincall/vitest';
import { launch, startProxy, type Mode } from 'test-proxy';
import { afterAll } from 'vitest';

interface StartOptions {
  fixture: string;
  log?: string;
  env?: Record<string, string>;
  cols?: number;
  cwd?: string;
}

const cli = ['node', fileURLToPath(new URL('../packages/twilight-factory/dist/cli.js', import.meta.url))];

const proxy = await startProxy({
  mode: (process.env.NETWORK ?? 'replay') as Mode,
  recordings: fileURLToPath(new URL('./docker/recordings', import.meta.url)),
});
afterAll(() => proxy.stop());
const fixtures = (fixture: string) => fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));

const proxyEnv = (fixture: string, log?: string) => proxy.session(fixtures(fixture), log).env;

// For code that runs in the test's own process: pass `session.fetch` to it, read `session.requests`.
const proxySession = (fixture: string) => proxy.session(fixtures(fixture));

// curtaincall has no cwd option, so `cwd` goes through `env -C`.
const startTf = (terminal: TerminalFactory, { fixture, log, env = {}, cols, cwd }: StartOptions) => {
  const session = proxy.session(fixtures(fixture), log);
  const command = cwd ? ['env', '-C', cwd, ...cli] : cli;
  return { term: launch(terminal, command, session, { env, cols }), log: session.id };
};

const waitForStatus = async (term: Terminal, status: RegExp | string) => {
  await expectTerminal(term.getByText(status)).toBeVisible();
  return term;
};

const requestLog = (log: string) => proxy.session(undefined, log).requests;

// Pass `log` to startTf; `next` resolves on the first matching request as it arrives.
const proxyRequests = async () => {
  const session = proxy.session();
  return { log: session.id, next: session.next };
};

const helpers = { cli, proxyEnv, proxySession, startTf, waitForStatus, requestLog, proxyRequests };
Object.assign(globalThis, helpers);

declare global {
  var cli: typeof helpers.cli;
  var proxyEnv: typeof helpers.proxyEnv;
  var proxySession: typeof helpers.proxySession;
  var startTf: typeof helpers.startTf;
  var waitForStatus: typeof helpers.waitForStatus;
  var requestLog: typeof helpers.requestLog;
  var proxyRequests: typeof helpers.proxyRequests;
}
