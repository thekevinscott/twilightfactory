import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { lockPath, socketPath, socketRecord, stateFolder } from "../paths.js";
import { readRecord } from "../records.js";
import { Factory } from "./factory.js";

function failure(error: unknown) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function app(factory: Factory, stop: () => void): Hono {
  const routes = new Hono();

  routes.get("/status", async (c) => c.json(await factory.snapshot()));

  routes.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let changed = true;
      let wake = () => {};
      const listener = () => {
        changed = true;
        wake();
      };
      factory.listeners.add(listener);
      stream.onAbort(listener);
      try {
        while (!stream.aborted && !factory.closing) {
          if (!changed) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          changed = false;
          await stream.writeSSE({ event: "state", data: JSON.stringify(await factory.snapshot()) });
        }
      } finally {
        factory.listeners.delete(listener);
      }
    }),
  );

  routes.post("/actions/:name/run", (c) => {
    try {
      return c.json({ ok: true, id: factory.runAction(c.req.param("name"), "manual") });
    } catch (error) {
      return c.json(failure(error), 404);
    }
  });

  routes.post("/agents", async (c) => {
    try {
      const body = (await c.req.json()) as { prompt?: unknown };
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      return c.json({ ok: true, id: await factory.startAgent(prompt) });
    } catch (error) {
      return c.json(failure(error), 400);
    }
  });

  routes.get("/actions/runs/:id/log", (c) => {
    const path = factory.logPath("actions", c.req.param("id"));
    if (!path) {
      return c.text("no such action run", 404);
    }
    const log = String(readRecord(path).log);
    return c.text(existsSync(log) ? readFileSync(log, "utf8") : "");
  });

  routes.get("/agents/runs/:id/log", (c) => {
    const path = factory.logPath("agents", c.req.param("id"));
    if (!path) {
      return c.text("no such agent run", 404);
    }
    const record = readRecord(path);
    return c.text(`prompt: ${record.prompt}\nworktree: ${record.worktree}\n${record.error ?? ""}\n`);
  });

  routes.post("/stop", (c) => {
    setImmediate(stop);
    return c.json({ ok: true });
  });

  return routes;
}

export async function serveDaemon(root: string): Promise<void> {
  mkdirSync(stateFolder(root), { recursive: true });
  let release: () => Promise<void>;
  try {
    release = await lock(stateFolder(root), { lockfilePath: lockPath(root) });
  } catch {
    throw new Error(`a daemon is already running for ${root}.`);
  }
  const path = socketPath(root);
  rmSync(path, { force: true });
  const factory = new Factory(root);
  await factory.start();

  let stopped = false;
  const finished = Promise.withResolvers<void>();
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    factory.stop();
    rmSync(socketRecord(root), { force: true });
    server.close();
    (server as unknown as { closeAllConnections(): void }).closeAllConnections();
    rmSync(path, { force: true });
    void release().finally(() => finished.resolve());
  };

  const server = createAdaptorServer({ fetch: app(factory, stop).fetch });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  writeFileAtomic.sync(socketRecord(root), `${path}\n`);
  process.stdout.write(`twilightfactory daemon for ${root}\nsocket ${path}\nstate ${factory.records}\n`);
  await finished.promise;
}
