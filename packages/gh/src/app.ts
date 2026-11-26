import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { client } from "./client.js";

export interface AppConfig {
  appId: string;
  installationId: number;
  privateKey: string;
}

const DEFAULT_KEY_FILE = "github-app.pem";

const readJson = async (file: string): Promise<Record<string, unknown> | undefined> => {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // biome-ignore lint/style/useErrorCause: the message is what the user needs; adding a cause changes the printed error
    throw new Error(`${file} is not valid JSON`);
  }
};

// Undefined when there is no config file; throws when there is one that can't be used.
export const readAppConfig = async (file: string): Promise<AppConfig | undefined> => {
  const config = await readJson(file);
  if (config === undefined) { return undefined; }
  const { appId, installationId, privateKeyPath = DEFAULT_KEY_FILE } = config;
  if (typeof appId !== "number" && typeof appId !== "string") { throw new Error(`${file} needs an appId`); }
  if (typeof installationId !== "number") { throw new Error(`${file} needs a numeric installationId`); }
  if (typeof privateKeyPath !== "string") { throw new Error(`${file}: privateKeyPath must be a path`); }
  const keyFile = path.resolve(path.dirname(file), privateKeyPath);
  let privateKey: string;
  try {
    privateKey = await readFile(keyFile, "utf8");
  } catch {
    // biome-ignore lint/style/useErrorCause: the message is what the user needs; adding a cause changes the printed error
    throw new Error(`can't read the GitHub App key at ${keyFile}`);
  }
  if (!privateKey.includes("PRIVATE KEY-----")) { throw new Error(`${keyFile} is not a PEM private key`); }
  return { appId: String(appId), installationId, privateKey };
};

// Writes that should show as the app go through this client; Octokit mints and refreshes the installation token.
export const dispatchClient = (
  token: string,
  app: AppConfig | undefined,
  options: ConstructorParameters<typeof Octokit>[0] = {},
): Octokit => (app === undefined ? client(token, options) : new Octokit({ ...options, authStrategy: createAppAuth, auth: app }));
