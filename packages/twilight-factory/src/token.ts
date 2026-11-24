import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";

export type Verification = { userCode: string; verificationUri: string };

const tokenFile = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "twilightfactory", "github-token");

const fromGh = async (): Promise<string | undefined> => {
  try {
    return (await promisify(execFile)("gh", ["auth", "token"])).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

const fromFile = async (): Promise<string | undefined> => {
  try {
    return (await readFile(tokenFile(), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
};

const signIn = async (clientId: string, onVerification: (verification: Verification) => void): Promise<string> => {
  const auth = createOAuthDeviceAuth({
    clientType: "oauth-app",
    clientId,
    scopes: ["repo"],
    onVerification: ({ user_code, verification_uri }) =>
      onVerification({ userCode: user_code, verificationUri: verification_uri }),
  });
  const { token } = await auth({ type: "oauth" });
  await mkdir(path.dirname(tokenFile()), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile(), `${token}\n`, { mode: 0o600 });
  return token;
};

export class NoClientIdError extends Error {
  constructor() {
    super("no GitHub token: sign-in needs TF_GITHUB_CLIENT_ID (or set GH_TOKEN, or run gh auth login)");
  }
}

let pendingSignIn: Promise<string> | undefined;

// Environment, then gh's login, then a token tf saved, then GitHub's device flow sign-in.
export const githubToken = async (onVerification: (verification: Verification) => void): Promise<string> => {
  const found = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || (await fromGh()) || (await fromFile());
  if (found) {
    return found;
  }
  const clientId = process.env.TF_GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new NoClientIdError();
  }
  pendingSignIn ??= signIn(clientId, onVerification).finally(() => {
    pendingSignIn = undefined;
  });
  return pendingSignIn;
};
