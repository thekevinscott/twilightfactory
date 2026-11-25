import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findFixture, launch, startProxy, type Proxy } from "../src/index.js";

const fixtureFolder = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "test-proxy-fixture-"));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
  return dir;
};

// Each request runs in a child process, the way the proxy is used.
const script = `
const [url, method, body] = process.argv.slice(1);
const response = await fetch(url, { method, body: body || undefined, headers: { authorization: 'token gho_test' } });
console.log(JSON.stringify({ status: response.status, body: await response.text() }));`;

const fetchThrough = async (env: Record<string, string>, url: string, { method = "GET", body = "" } = {}) => {
  const { stdout } = await promisify(execFile)("node", ["--input-type=module", "-e", script, url, method, body], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout) as { status: number; body: string };
};

describe("findFixture", () => {
  const dir = fixtureFolder({
    "api.github.com/repos/a/b.json": '{"name":"b"}',
    "api.github.com/repos/a/b/dispatches.204.json": "",
    "api.github.com/repos/a/missing.404.json": '{"message":"Not Found"}',
  });

  test("it answers 200 from <path>.json", () => {
    const found = findFixture(dir, "https://api.github.com/repos/a/b");
    expect(found?.status).toBe(200);
    expect(found?.body.toString()).toBe('{"name":"b"}');
  });

  test("it answers the status named in <path>.<status>.json", () => {
    expect(findFixture(dir, "https://api.github.com/repos/a/missing")?.status).toBe(404);
    expect(findFixture(dir, "https://api.github.com/repos/a/b/dispatches")?.status).toBe(204);
  });

  test("it ignores the query string", () => {
    expect(findFixture(dir, "https://api.github.com/repos/a/b?per_page=1")?.status).toBe(200);
  });

  test("it finds nothing for a path with no file", () => {
    expect(findFixture(dir, "https://api.github.com/repos/a/none")).toBeUndefined();
    expect(findFixture(dir, "https://example.com/x")).toBeUndefined();
  });
});

describe("startProxy", () => {
  let proxy: Proxy;
  const dir = fixtureFolder({
    "api.github.com/repos/a/b.json": '{"name":"b"}',
    "api.github.com/repos/a/missing.404.json": '{"message":"Not Found"}',
    "api.github.com/repos/a/b/dispatches.204.json": "",
  });
  beforeAll(async () => { proxy = await startProxy(); });
  afterAll(async () => { await proxy.stop(); });

  test("a child process gets the fixture over HTTPS", async () => {
    const session = proxy.session(dir);
    expect(await fetchThrough(session.env, "https://api.github.com/repos/a/b")).toEqual({ status: 200, body: '{"name":"b"}' });
    expect((await fetchThrough(session.env, "https://api.github.com/repos/a/missing")).status).toBe(404);
  });

  test("a missing fixture answers 502 and names the URL", async () => {
    const session = proxy.session(dir);
    expect(await fetchThrough(session.env, "https://api.github.com/repos/a/none")).toEqual({
      status: 502,
      body: "no fixture for https://api.github.com/repos/a/none",
    });
  });

  test("it records each request with its method, URL, authorization and body", async () => {
    const session = proxy.session(dir);
    await fetchThrough(session.env, "https://api.github.com/repos/a/b");
    await fetchThrough(session.env, "https://api.github.com/repos/a/b/dispatches", { method: "POST", body: '{"ref":"main"}' });
    expect(session.requests).toEqual([
      { method: "GET", url: "https://api.github.com/repos/a/b", authorization: "token gho_test", body: "" },
      { method: "POST", url: "https://api.github.com/repos/a/b/dispatches", authorization: "token gho_test", body: '{"ref":"main"}' },
    ]);
  });

  test("sessions see only their own requests and fixtures", async () => {
    const one = proxy.session(dir);
    const two = proxy.session(fixtureFolder({ "api.github.com/repos/a/b.json": '{"name":"two"}' }));
    expect((await fetchThrough(two.env, "https://api.github.com/repos/a/b")).body).toBe('{"name":"two"}');
    expect(one.requests).toEqual([]);
    expect(two.requests).toHaveLength(1);
  });

  test("session(fixture, id) reuses the session with that id", async () => {
    const first = proxy.session(undefined, "named");
    const second = proxy.session(dir, "named");
    expect(second).toBe(first);
    expect((await fetchThrough(first.env, "https://api.github.com/repos/a/b")).status).toBe(200);
  });

  test("next resolves on the first matching request as it arrives", async () => {
    const session = proxy.session(dir);
    const dispatch = session.next(({ method }) => method === "POST");
    await fetchThrough(session.env, "https://api.github.com/repos/a/b");
    await fetchThrough(session.env, "https://api.github.com/repos/a/b/dispatches", { method: "POST", body: '{"ref":"main"}' });
    expect((await dispatch).body).toBe('{"ref":"main"}');
  });

  test("next resolves at once on a request that has already arrived", async () => {
    const session = proxy.session(dir);
    await fetchThrough(session.env, "https://api.github.com/repos/a/b");
    expect((await session.next(({ url }) => url.endsWith("/a/b"))).method).toBe("GET");
  });

  test("session.fetch reaches the fixture over HTTPS in-process and logs to the session", async () => {
    const session = proxy.session(dir);
    const other = proxy.session(fixtureFolder({ "api.github.com/repos/a/b.json": '{"name":"other"}' }));
    const response = await session.fetch("https://api.github.com/repos/a/b/dispatches", {
      method: "POST",
      body: '{"ref":"main"}',
      headers: { authorization: "token gho_test" },
    });
    expect(response.status).toBe(204);
    expect(await (await other.fetch("https://api.github.com/repos/a/b")).text()).toBe('{"name":"other"}');
    expect(session.requests).toEqual([
      { method: "POST", url: "https://api.github.com/repos/a/b/dispatches", authorization: "token gho_test", body: '{"ref":"main"}' },
    ]);
    expect(other.requests.map(({ url }) => url)).toEqual(["https://api.github.com/repos/a/b"]);
  });

  test("launch runs the command with the session's proxy env", async () => {
    const session = proxy.session(dir);
    const calls: [string, { env: Record<string, string>; cols?: number }][] = [];
    launch((command: string, options: { env: Record<string, string>; cols?: number }) => calls.push([command, options]), ["node", "cli.js"], session, { env: { GH_TOKEN: "x" }, cols: 80 });
    expect(calls).toEqual([["node cli.js", { cols: 80, env: { ...session.env, GH_TOKEN: "x" } }]]);
    expect(session.env.HTTPS_PROXY).toMatch(/^http:\/\/metadata:.+@127\.0\.0\.1:\d+$/);
    expect(readFileSync(session.env.NODE_EXTRA_CA_CERTS!, "utf8")).toContain("BEGIN CERTIFICATE");
  });
});

describe("record mode", () => {
  test("it passes requests through and saves 200 JSON answers under the host and path", async () => {
    const upstream = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const recordings = mkdtempSync(path.join(tmpdir(), "test-proxy-recordings-"));
    const proxy = await startProxy({ mode: "record", recordings });
    try {
      const session = proxy.session();
      const { port } = upstream.address() as AddressInfo;
      const answer = await fetchThrough(session.env, `http://127.0.0.1:${port}/repos/a/b?x=1`);
      expect(JSON.parse(answer.body)).toEqual({ path: "/repos/a/b?x=1" });
      expect(session.requests.map(({ url }) => url)).toEqual([`http://127.0.0.1:${port}/repos/a/b?x=1`]);
      expect(JSON.parse(readFileSync(path.join(recordings, `127.0.0.1:${port}`, "repos/a/b.json"), "utf8"))).toEqual({ path: "/repos/a/b?x=1" });
    } finally {
      await proxy.stop();
      upstream.close();
    }
  });
});
