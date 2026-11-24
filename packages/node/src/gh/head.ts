import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const headCommit = async (): Promise<string> => {
  const { stdout } = await promisify(execFile)("gh", ["api", "repos/{owner}/{repo}/commits/HEAD"]);
  return (JSON.parse(stdout) as { sha: string }).sha;
};
