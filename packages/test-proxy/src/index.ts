import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateCACertificate, getLocal, type CompletedRequest } from "mockttp";
import { fetch as undiciFetch, ProxyAgent } from "undici";

export interface Request {
  method: string;
  url: string;
  authorization: string | null;
  body: string;
}

export interface Session {
  id: string;
  /** Proxy and CA variables for a child process. */
  env: Record<string, string>;
  /** A fetch routed through this session, for code under test that runs in the test's own process. */
  fetch: typeof undiciFetch;
  requests: Request[];
  next: (match: (request: Request) => boolean) => Promise<Request>;
}

export interface Proxy {
  url: string;
  caFile: string;
  /** `fixture` is a folder of `<host>/<path>.json` files; an existing `id` returns that session with the fixture set. */
  session: (fixture?: string, id?: string) => Session;
  stop: () => Promise<void>;
}

/**
 * replay answers from the session's fixture folder and never touches the network.
 * record passes through and saves 200 JSON answers to `recordings`; live passes through.
 */
export type Mode = "replay" | "record" | "live";

const fixtureBase = (dir: string, url: string) => {
  const { host, pathname } = new URL(url);
  return path.join(dir, host, pathname);
};

/** `<path>.json` answers 200; `<path>.<status>.json` answers that status. */
export const findFixture = (dir: string, url: string): { status: number; body: Buffer } | undefined => {
  const base = fixtureBase(dir, url);
  if (existsSync(`${base}.json`)) return { status: 200, body: readFileSync(`${base}.json`) };
  const parent = path.dirname(base);
  const name = path.basename(base);
  if (!existsSync(parent)) return undefined;
  const file = readdirSync(parent).find((entry) => entry.startsWith(`${name}.`) && /^\d{3}\.json$/.test(entry.slice(name.length + 1)));
  if (!file) return undefined;
  return { status: Number(file.slice(name.length + 1, -5)), body: readFileSync(path.join(parent, file)) };
};

const TAG = "socket-metadata:";

export const startProxy = async ({ mode = "replay", recordings }: { mode?: Mode; recordings?: string } = {}): Promise<Proxy> => {
  const ca = await generateCACertificate({ subject: { commonName: "test-proxy CA" } });
  const caFile = path.join(mkdtempSync(path.join(tmpdir(), "test-proxy-ca-")), "ca.pem");
  writeFileSync(caFile, ca.cert);
  const server = getLocal({ https: ca });
  await server.start();
  const url = `http://127.0.0.1:${server.port}`;

  type State = Session & { fixture?: string; waiting: [(request: Request) => boolean, (request: Request) => void][] };
  const sessions = new Map<string, State>();
  const sessionOf = (req: CompletedRequest) => {
    const tag = req.tags.find((t) => t.startsWith(TAG));
    return tag ? sessions.get(tag.slice(TAG.length)) : undefined;
  };
  const record = async (req: CompletedRequest) => {
    const session = sessionOf(req);
    if (!session) return undefined;
    const { authorization } = req.headers;
    const request: Request = {
      method: req.method,
      url: req.url,
      authorization: typeof authorization === "string" ? authorization : null,
      body: (await req.body.getText()) ?? "",
    };
    session.requests.push(request);
    for (const [match, resolve] of session.waiting) if (match(request)) resolve(request);
    return session;
  };

  if (mode === "replay") {
    await server.forAnyRequest().thenCallback(async (req) => {
      const session = await record(req);
      const found = session?.fixture ? findFixture(session.fixture, req.url) : undefined;
      if (!found) return { statusCode: 502, body: `no fixture for ${req.url}` };
      return { statusCode: found.status, body: found.body, headers: { "content-type": "application/json" } };
    });
  } else {
    await server.forAnyRequest().thenPassThrough({
      beforeRequest: async (req) => { await record(req); },
      beforeResponse: async (res, req) => {
        if (mode !== "record" || !recordings || res.statusCode !== 200) return;
        if (!res.headers["content-type"]?.includes("json")) return;
        const target = `${fixtureBase(recordings, req.url)}.json`;
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, `${JSON.stringify(await res.body.getJson(), null, 2)}\n`);
      },
    });
  }

  const agents: ProxyAgent[] = [];
  const session = (fixture?: string, id: string = randomUUID()) => {
    const existing = sessions.get(id);
    if (existing) {
      existing.fixture = fixture ?? existing.fixture;
      return existing;
    }
    const metadata = Buffer.from(JSON.stringify({ tags: [id] })).toString("base64url");
    const proxyUrl = `http://metadata:${metadata}@127.0.0.1:${server.port}`;
    let agent: ProxyAgent | undefined;
    const dispatcher = () => {
      if (!agent) agents.push((agent = new ProxyAgent({ uri: proxyUrl, requestTls: { ca: ca.cert } })));
      return agent;
    };
    const state: State = {
      id,
      fixture,
      env: {
        HTTPS_PROXY: proxyUrl,
        HTTP_PROXY: proxyUrl,
        NODE_USE_ENV_PROXY: "1",
        NODE_EXTRA_CA_CERTS: caFile,
        SSL_CERT_FILE: caFile,
      },
      // undici's own fetch: the global one is a separately bundled undici and may reject this agent.
      fetch: (input, init) => undiciFetch(input, { ...init, dispatcher: dispatcher() }),
      requests: [],
      waiting: [],
      next: (match) => new Promise((resolve) => {
        const found = state.requests.find(match);
        if (found) resolve(found);
        else state.waiting.push([match, resolve]);
      }),
    };
    sessions.set(id, state);
    return state;
  };

  const stop = async () => {
    await Promise.all(agents.map((agent) => agent.close()));
    await server.stop();
  };
  return { url, caFile, session, stop };
};

/** Runs `command` through a terminal factory (e.g. curtaincall's) with the session's proxy env. */
export const launch = <T>(
  terminal: (command: string, options: { env: Record<string, string>; cols?: number }) => T,
  command: string[],
  session: Pick<Session, "env">,
  { env = {}, cols }: { env?: Record<string, string>; cols?: number } = {},
): T => terminal(command.join(" "), { cols, env: { ...session.env, ...env } });
