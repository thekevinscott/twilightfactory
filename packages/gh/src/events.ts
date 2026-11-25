import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Octokit } from "@octokit/rest";
import {
  Webhooks,
  createNodeMiddleware,
  type EmitterWebhookEvent,
  type EmitterWebhookEventName,
} from "@octokit/webhooks";
import { LRUCache } from "lru-cache";
import PQueue from "p-queue";
import { SmeeClient } from "smee-client";

// `key` must come from the resource itself (id plus updated_at, say), so webhook and poll agree on it.
export interface Change<T = unknown> {
  key: string;
  data: T;
}

export interface GitHubEvent<T = unknown> extends Change<T> {
  type: string;
  via: "webhook" | "poll";
}

export interface PollContext {
  github: Octokit;
  repo: string;
  // Start of this source's last successful poll; null on the first.
  since: Date | null;
  // GET with ETag caching: an unchanged response comes back as 304, which costs no rate limit.
  get: <T>(route: string, params?: Record<string, unknown>) => Promise<T>;
}

export interface Source<T = unknown, E extends EmitterWebhookEventName = EmitterWebhookEventName> {
  type: string;
  webhook?: { event: E | E[]; changes: (event: EmitterWebhookEvent<E>) => Change<T>[] };
  poll?: (context: PollContext) => Promise<Change<T>[]>;
}

export const defineSource = <T, E extends EmitterWebhookEventName>(source: Source<T, E>): Source<T, E> => source;

export type Handler<T = unknown> = (event: GitHubEvent<T>) => unknown;

export interface EventSourceOptions {
  github: Octokit;
  repo: string;
  sources: Source<any, any>[];
  secret?: string;
  interval?: number;
  remember?: number;
  onError?: (error: unknown, event?: GitHubEvent) => void;
}

export interface ServeOptions {
  port?: number;
  // A smee.io channel whose deliveries are forwarded to the local server.
  smee?: string;
}

export const eventSource = ({
  github,
  repo,
  sources,
  secret,
  interval = 60_000,
  remember = 10_000,
  onError = error => console.error(error),
}: EventSourceOptions) => {
  const [owner = "", name = ""] = repo.split("/");
  const handlers = new Map<string, Handler[]>();
  const seen = new LRUCache<string, true>({ max: remember });
  const queue = new PQueue({ concurrency: 1 });
  const webhooks = new Webhooks({ secret: secret ?? "" });
  const etags = new Map<string, { etag: string; data: unknown }>();
  const since = new Map<Source, Date>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let server: Server | undefined;
  let smee: SmeeClient | undefined;

  const enqueue = (type: string, via: GitHubEvent["via"], changes: Change[]) => {
    for (const change of changes) {
      const id = `${type}:${change.key}`;
      if (seen.has(id)) continue;
      seen.set(id, true);
      const event: GitHubEvent = { type, via, ...change };
      void queue.add(async () => {
        for (const handler of handlers.get(type) ?? []) {
          try {
            await handler(event);
          } catch (error) {
            onError(error, event);
          }
        }
      });
    }
  };

  const get = async <T>(route: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = JSON.stringify([route, params]);
    const cached = etags.get(id);
    try {
      const response = await github.request(route, {
        owner,
        repo: name,
        ...params,
        headers: cached ? { "if-none-match": cached.etag } : {},
      });
      if (response.headers.etag) etags.set(id, { etag: response.headers.etag, data: response.data });
      return response.data as T;
    } catch (error) {
      if (cached && (error as { status?: number }).status === 304) return cached.data as T;
      throw error;
    }
  };

  for (const source of sources) {
    if (!source.webhook) continue;
    const { event, changes } = source.webhook;
    webhooks.on(event, webhook => enqueue(source.type, "webhook", changes(webhook)));
  }

  const poll = async () => {
    for (const source of sources) {
      if (!source.poll) continue;
      const started = new Date();
      try {
        enqueue(source.type, "poll", await source.poll({ github, repo, since: since.get(source) ?? null, get }));
        since.set(source, started);
      } catch (error) {
        onError(error);
      }
    }
  };

  const loop = async () => {
    await poll();
    if (running) timer = setTimeout(loop, interval);
  };

  return {
    on: <T = unknown>(type: string, handler: Handler<T>) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler as Handler]);
    },

    // Resolves after the first poll has been queued.
    start: async () => {
      running = true;
      await loop();
    },

    // Rejects when the signature does not match `secret`.
    receive: (delivery: { id: string; name: string; payload: string; signature: string }) =>
      webhooks.verifyAndReceive(delivery),

    serve: async ({ port = 0, smee: channel }: ServeOptions = {}) => {
      if (!secret) throw new Error("serve needs a webhook secret");
      server = createServer(createNodeMiddleware(webhooks, { path: "/" }));
      await new Promise<void>(resolve => server!.listen(port, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      if (channel) {
        smee = new SmeeClient({ source: channel, target: url, logger: { info: () => {}, error: onError } });
        await smee.start();
      }
      return { url };
    },

    stop: async () => {
      running = false;
      clearTimeout(timer);
      await smee?.stop();
      if (server) await new Promise(resolve => server!.close(resolve));
      await queue.onIdle();
    },
  };
};

export type EventSource = ReturnType<typeof eventSource>;
