import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect as expectTerminal, type Terminal } from 'curtaincall';
import type { TerminalFactory } from 'curtaincall/vitest';

type StartOptions = { fixture: string; log?: string; env?: Record<string, string>; cols?: number };
type Request = { method: string; url: string; authorization: string | null; [key: string]: unknown };

const cli = ['node', fileURLToPath(new URL('../packages/twilight-factory/dist/cli.js', import.meta.url))];

// The proxy answers from the fixture named as the username and logs requests under the password.
const proxyUrl = (fixture: string, log: string) =>
  `http://${encodeURIComponent(`tests/fixtures/${fixture}`)}:${log}@proxy:8080`;

const startTf = (terminal: TerminalFactory, { fixture, log = randomUUID().replaceAll('-', ''), env = {}, cols }: StartOptions) => {
  const term = terminal(cli.join(' '), { cols, env: { HTTPS_PROXY: proxyUrl(fixture, log), ...env } });
  return { term, log };
};

const waitForStatus = async (term: Terminal, status: RegExp | string) => {
  await expectTerminal(term.getByText(status)).toBeVisible({ timeout: 10_000 });
  return term;
};

const requestLog = (log: string): Request[] => {
  const file = path.join(process.env.PROXY_REQUESTS!, `${log}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
};

const helpers = { cli, proxyUrl, startTf, waitForStatus, requestLog };
Object.assign(globalThis, helpers);

declare global {
  var cli: typeof helpers.cli;
  var proxyUrl: typeof helpers.proxyUrl;
  var startTf: typeof helpers.startTf;
  var waitForStatus: typeof helpers.waitForStatus;
  var requestLog: typeof helpers.requestLog;
}
