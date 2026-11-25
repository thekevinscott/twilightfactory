import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect as expectTerminal, type Terminal } from 'curtaincall';
import type { TerminalFactory } from 'curtaincall/vitest';
import { onTestFinished } from 'vitest';

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

// Pass `log` to startTf and the proxy POSTs each request here as it arrives; `next` resolves on the first match.
const proxyRequests = async () => {
  const seen: Request[] = [];
  const waiting: [(request: Request) => boolean, (request: Request) => void][] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.end();
      const request: Request = JSON.parse(body);
      seen.push(request);
      for (const [match, resolve] of waiting) if (match(request)) resolve(request);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  onTestFinished(() => { server.close(); });
  return {
    log: `callback.${(server.address() as AddressInfo).port}`,
    next: (match: (request: Request) => boolean) => new Promise<Request>(resolve => {
      const found = seen.find(match);
      if (found) resolve(found);
      else waiting.push([match, resolve]);
    }),
  };
};

const helpers = { cli, proxyUrl, startTf, waitForStatus, requestLog, proxyRequests };
Object.assign(globalThis, helpers);

declare global {
  var cli: typeof helpers.cli;
  var proxyUrl: typeof helpers.proxyUrl;
  var startTf: typeof helpers.startTf;
  var waitForStatus: typeof helpers.waitForStatus;
  var requestLog: typeof helpers.requestLog;
  var proxyRequests: typeof helpers.proxyRequests;
}
