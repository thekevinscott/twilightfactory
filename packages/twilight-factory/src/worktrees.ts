import { execFile } from "node:child_process";
import { readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const git = async (cwd: string, ...args: string[]) =>
  (await promisify(execFile)("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();

const failure = (error: unknown) =>
  ((error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error))).split("\n")[0];

interface Worktree {
  path: string;
  branch?: string;
}

// The main checkout is always listed first.
const worktrees = async (cwd: string): Promise<Worktree[]> =>
  (await git(cwd, "worktree", "list", "--porcelain")).split("\n\n").map(block => {
    const lines = block.split("\n");
    const worktree = lines.find(line => line.startsWith("worktree "))!.slice("worktree ".length);
    const branch = lines.find(line => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    return { path: worktree, branch };
  });

const inside = (dir: string, target: string) => target === dir || target.startsWith(`${dir}/`);

// Any process whose cwd is in the worktree: a shell, an agent, a test run.
// Linux only; elsewhere this throws and the worktree is kept.
const processIn = async (dir: string): Promise<number | undefined> => {
  const entries = await readdir("/proc");
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) { continue; }
    try {
      if (inside(dir, await readlink(`/proc/${entry}/cwd`))) { return Number(entry); }
    } catch {
      // Gone, or another user's.
    }
  }
  return undefined;
};

const reasonToKeep = async (main: string, { path: dir, branch }: Worktree & { branch: string }) => {
  if (await git(dir, "status", "--porcelain")) { return "uncommitted changes"; }
  if ((await git(main, "rev-list", "--count", `refs/heads/${branch}`, "--not", "--remotes")) !== "0") { return "unpushed commits"; }
  let pid: number | undefined;
  try {
    pid = await processIn(dir);
  } catch (error) {
    return `cannot check for running processes: ${failure(error)}`;
  }
  if (pid !== undefined) { return `a process is running in it (pid ${pid})`; }
};

const succeeds = (cwd: string, ...args: string[]) => git(cwd, ...args).then(() => true, () => false);

export interface ClosedPullRequest {
  number: number;
  merged: boolean;
}

// Why a worktree may go: its newest pull request closed, or its pushed branch is already in main.
// A branch never pushed is someone's new work, even when it still points at main.
const done = async (main: string, branch: string, pr: ClosedPullRequest | undefined) => {
  if (pr) { return { label: `#${pr.number} ${pr.merged ? "merged" : "closed"}`, merged: pr.merged }; }
  const pushed = await succeeds(main, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`);
  if (pushed && (await succeeds(main, "merge-base", "--is-ancestor", `refs/heads/${branch}`, "refs/remotes/origin/main"))) {
    return { label: `${branch} merged into main`, merged: true };
  }
};

const remove = async (main: string, worktree: Worktree & { branch: string }, merged: boolean) => {
  const name = path.relative(main, worktree.path);
  const reason = await reasonToKeep(main, worktree);
  if (reason) { return `kept ${name}: ${reason}`; }
  try {
    await git(main, "worktree", "remove", worktree.path);
  } catch (error) {
    return `kept ${name}: ${failure(error)}`;
  }
  try {
    // reasonToKeep has checked that every commit is on the remote, so a closed branch can go unmerged.
    await git(main, "branch", merged ? "-d" : "-D", worktree.branch);
  } catch (error) {
    return `removed ${name}, kept branch ${worktree.branch}: ${failure(error)}`;
  }
  return `removed ${name} and branch ${worktree.branch}`;
};

let queue: Promise<unknown> = Promise.resolve();
const serially = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => null);
  return next;
};

// `closed` maps a branch to its newest pull request, when that one is closed. Branches with an open one are absent.
export const sweepWorktrees = (cwd: string, closed: Map<string, ClosedPullRequest>): Promise<string[]> =>
  serially(async () => {
    const [main, ...rest] = await worktrees(cwd);
    const root = path.join(main!.path, ".worktrees");
    // Brings in merges, so `git branch -d` sees a branch as merged into its upstream.
    await git(main!.path, "fetch", "origin").catch(() => undefined);
    const lines: string[] = [];
    for (const worktree of rest) {
      const { branch } = worktree;
      if (!(branch && inside(root, worktree.path))) { continue; }
      const why = await done(main!.path, branch, closed.get(branch));
      if (why) { lines.push(`${why.label}: ${await remove(main!.path, { ...worktree, branch }, why.merged)}`); }
    }
    return lines;
  });

// Fast-forwards the checkout tf runs from. Returns a line to show, or undefined when main was already current.
export const pullMain = (cwd: string): Promise<string | undefined> =>
  serially(async () => {
    const branch = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    if (branch !== "main") { return `did not pull main: the checkout is on ${branch}`; }
    if (await git(cwd, "status", "--porcelain", "--untracked-files=no")) { return "did not pull main: uncommitted changes"; }
    const before = await git(cwd, "rev-parse", "HEAD");
    try {
      await git(cwd, "pull", "--ff-only", "--quiet");
    } catch (error) {
      return `did not pull main: ${failure(error)}`;
    }
    const after = await git(cwd, "rev-parse", "--short", "HEAD");
    return (await git(cwd, "rev-parse", "HEAD")) === before ? undefined : `pulled main to ${after}`;
  });
