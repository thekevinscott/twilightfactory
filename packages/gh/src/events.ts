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

// Handed to `poll` and to `webhook.changes`, so a webhook can fetch what its payload leaves out.
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
  webhook?: {
    event: E | E[];
    changes: (event: EmitterWebhookEvent<E>, context: PollContext) => Change<T>[] | Promise<Change<T>[]>;
  };
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
  const webhooks = secret ? new Webhooks({ secret }) : undefined;
  const etags = new Map<string, { etag: string; data: unknown }>();
  const since = new Map<Source, Date>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let server: Server | undefined;
  let smee: SmeeClient | undefined;
  const pending = new Set<Promise<void>>();

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

  const needWebhooks = (method: string) => {
    if (!webhooks) throw new Error(`${method} needs a webhook secret`);
    return webhooks;
  };

  const context = (source: Source): PollContext => ({ github, repo, since: since.get(source) ?? null, get });

  // An async `changes` is not awaited, so the delivery is acknowledged before its fetches finish; `stop` waits for them.
  for (const source of sources) {
    if (!webhooks || !source.webhook) continue;
    const { event, changes } = source.webhook;
    webhooks.on(event, webhook => {
      const result = changes(webhook, context(source));
      if (Array.isArray(result)) return enqueue(source.type, "webhook", result);
      const work = result.then(
        found => enqueue(source.type, "webhook", found),
        error => onError(error),
      );
      pending.add(work);
      void work.finally(() => pending.delete(work));
    });
  }

  const poll = async () => {
    for (const source of sources) {
      if (!source.poll) continue;
      const started = new Date();
      try {
        enqueue(source.type, "poll", await source.poll(context(source)));
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

    // Rejects when the signature does not match `secret`, or when there is no `secret`.
    receive: async (delivery: { id: string; name: string; payload: string; signature: string }) =>
      needWebhooks("receive").verifyAndReceive(delivery),

    serve: async ({ port = 0, smee: channel }: ServeOptions = {}) => {
      server = createServer(createNodeMiddleware(needWebhooks("serve"), { path: "/" }));
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
      await Promise.all(pending);
      await queue.onIdle();
    },
  };
};

export type EventSource = ReturnType<typeof eventSource>;
