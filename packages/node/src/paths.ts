import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

function repoKey(root: string): string {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}

export function runtimeFolder(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  const folder = runtime
    ? join(runtime, "twilightfactory")
    : join(tmpdir(), `twilightfactory-${userInfo().uid}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

export function socketPath(root: string): string {
  return join(runtimeFolder(), `${repoKey(root)}.sock`);
}

export function stateFolder(root: string): string {
  const home = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(home, "twilightfactory", repoKey(root));
}

export function recordsFolder(root: string): string {
  return join(stateFolder(root), "records");
}

export function socketRecord(root: string): string {
  return join(stateFolder(root), "daemon.socket");
}

export function lockPath(root: string): string {
  return join(stateFolder(root), "daemon.lock");
}

export function daemonErrors(root: string): string {
  return join(stateFolder(root), "daemon.stderr");
}
