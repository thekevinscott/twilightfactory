import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { daemonErrors, socketRecord, stateFolder } from "../paths.js";
import { listening } from "./listening.js";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const START_SECONDS = 20;

export async function daemonSocket(root: string): Promise<string | null> {
  const record = socketRecord(root);
  if (!existsSync(record)) {
    return null;
  }
  const path = readFileSync(record, "utf8").trim();
  if (path && (await listening(path))) {
    return path;
  }
  rmSync(record, { force: true });
  return null;
}

export async function ensureDaemon(root: string): Promise<string> {
  const found = await daemonSocket(root);
  if (found) {
    return found;
  }
  mkdirSync(stateFolder(root), { recursive: true });
  let exited = false;
  const child = execa(process.execPath, [CLI, "daemon"], {
    cwd: root,
    detached: true,
    reject: false,
    cleanup: false,
    stdin: "ignore",
    stdout: "ignore",
    stderr: { file: daemonErrors(root), append: true },
  });
  void child.then(() => {
    exited = true;
  });
  child.nodeChildProcess.unref();
  for (let waited = 0; waited < START_SECONDS * 10; waited += 1) {
    const path = await daemonSocket(root);
    if (path) {
      return path;
    }
    if (exited) {
      break;
    }
    await sleep(100);
  }
  const tail = readFileSync(daemonErrors(root), "utf8").trim().split("\n").slice(-5).join("\n");
  throw new Error(`the daemon did not start.\n${tail}`);
}
