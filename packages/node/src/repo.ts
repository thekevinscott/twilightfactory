import { execa } from "execa";

export async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execa("git", args, {
    cwd: root,
    stdin: "ignore",
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(`${cwd} is not inside a git repo.`);
  }
}

export interface RemoteHead {
  branch: string;
  head: string;
}

export async function remoteHead(
  root: string,
  remote: string,
  branch: string | undefined,
): Promise<RemoteHead> {
  if (branch !== undefined) {
    const out = await git(root, ["ls-remote", remote, `refs/heads/${branch}`]);
    const head = out.split(/\s+/)[0];
    if (!head) {
      throw new Error(`${remote} has no branch ${branch}`);
    }
    return { branch, head };
  }
  const out = await git(root, ["ls-remote", "--symref", remote, "HEAD"]);
  const symref = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(out)?.[1];
  const head = /^([0-9a-f]{40,64})\s+HEAD$/m.exec(out)?.[1];
  if (!symref || !head) {
    throw new Error(`${remote} has no default branch head`);
  }
  return { branch: symref, head };
}
