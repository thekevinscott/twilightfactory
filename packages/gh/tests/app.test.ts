import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";
const api = "https://api.github.com";

// GitHub hands out app keys as PKCS#1; this one is made per run and never leaves the test.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

interface Request {
  method: string;
  url: string;
  authorization: string;
}

const fakeGitHub = () => {
  const requests: Request[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    requests.push({ method: init.method ?? "GET", url, authorization: headers.get("authorization") ?? "" });
    if (url.endsWith("/access_tokens")) {
      return Response.json(
        { token: "ghs_installation", expires_at: "2099-01-01T00:00:00Z", permissions: { actions: "write" } },
        { status: 201 },
      );
    }
    return new Response(null, { status: 204 });
  };
  return { fetch, requests };
};

const app: gh.AppConfig = { appId: "123", installationId: 456, privateKey };

test("dispatchClient uses the user token when no app is configured", async () => {
  const { fetch, requests } = fakeGitHub();
  await gh.startRun(gh.dispatchClient("gho_user", undefined, { request: { fetch } }), repo, "plain");
  expect(requests).toEqual([
    { method: "POST", url: `${api}/repos/${repo}/actions/workflows/tests.yml/dispatches`, authorization: "token gho_user" },
  ]);
});

test("dispatchClient dispatches with the app's installation token when an app is configured", async () => {
  const { fetch, requests } = fakeGitHub();
  await gh.startRun(gh.dispatchClient("gho_user", app, { request: { fetch } }), repo, "plain");
  expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
    `POST ${api}/app/installations/456/access_tokens`,
    `POST ${api}/repos/${repo}/actions/workflows/tests.yml/dispatches`,
  ]);
  expect(requests[0]?.authorization).toMatch(/^bearer ey/);
  expect(requests[1]?.authorization).toBe("token ghs_installation");
});

const configDir = () => mkdtempSync(path.join(tmpdir(), "tf-app-"));

test("readAppConfig is undefined when there is no config file", async () => {
  expect(await gh.readAppConfig(path.join(configDir(), "github-app.json"))).toBeUndefined();
});

test("readAppConfig reads the ids and the key next to the config file", async () => {
  const dir = configDir();
  writeFileSync(path.join(dir, "github-app.pem"), privateKey);
  writeFileSync(path.join(dir, "github-app.json"), JSON.stringify({ appId: 123, installationId: 456 }));
  expect(await gh.readAppConfig(path.join(dir, "github-app.json"))).toEqual({ appId: "123", installationId: 456, privateKey });
});

test("readAppConfig reads the key from privateKeyPath", async () => {
  const dir = configDir();
  const keyFile = path.join(configDir(), "elsewhere.pem");
  writeFileSync(keyFile, privateKey);
  writeFileSync(path.join(dir, "github-app.json"), JSON.stringify({ appId: 123, installationId: 456, privateKeyPath: keyFile }));
  expect((await gh.readAppConfig(path.join(dir, "github-app.json")))?.privateKey).toBe(privateKey);
});

test.for([
  ["not JSON", "{", undefined, /github-app\.json/],
  ["no appId", JSON.stringify({ installationId: 456 }), privateKey, /appId/],
  ["no installationId", JSON.stringify({ appId: 123 }), privateKey, /installationId/],
  ["no key file", JSON.stringify({ appId: 123, installationId: 456 }), undefined, /github-app\.pem/],
  ["a key file that is not a key", JSON.stringify({ appId: 123, installationId: 456 }), "hello", /private key/],
] as const)("readAppConfig rejects a config with %s", async ([, config, key, message]) => {
  const dir = configDir();
  writeFileSync(path.join(dir, "github-app.json"), config);
  if (key !== undefined) { writeFileSync(path.join(dir, "github-app.pem"), key); }
  await expect(gh.readAppConfig(path.join(dir, "github-app.json"))).rejects.toThrow(message);
});
