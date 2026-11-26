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

// Returns a line to show, or undefined when the branch has no worktree under .worktrees/.
export const removeMergedWorktree = async (cwd: string, branch: string): Promise<string | undefined> => {
  const [main, ...rest] = await worktrees(cwd);
  const root = path.join(main!.path, ".worktrees");
  const worktree = rest.find(w => w.branch === branch && inside(root, w.path));
  if (!worktree) { return undefined; }
  const name = path.relative(main!.path, worktree.path);

  // Brings in the merge, so `git branch -d` sees the branch as merged into its upstream.
  await git(main!.path, "fetch", "origin").catch(() => undefined);

  const reason = await reasonToKeep(main!.path, { path: worktree.path, branch });
  if (reason) { return `kept ${name}: ${reason}`; }
  try {
    await git(main!.path, "worktree", "remove", worktree.path);
  } catch (error) {
    return `kept ${name}: ${failure(error)}`;
  }
  try {
    await git(main!.path, "branch", "-d", branch);
  } catch (error) {
    return `removed ${name}, kept branch ${branch}: ${failure(error)}`;
  }
  return `removed ${name} and branch ${branch}`;
};
