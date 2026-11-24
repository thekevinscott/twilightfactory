import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface Run {
  status: string;
  conclusion: string;
  workflowName: string;
  headBranch: string;
  displayTitle: string;
  createdAt: string;
}

const fields = ["status", "conclusion", "workflowName", "headBranch", "displayTitle", "createdAt"];

export const recentActions = async (limit: number): Promise<string> => {
  const { stdout } = await promisify(execFile)("gh", ["run", "list", "--limit", String(limit), "--json", fields.join(",")]);
  const rows = (JSON.parse(stdout) as Run[]).map(run => [
    run.conclusion || run.status,
    run.workflowName,
    run.headBranch,
    run.createdAt,
    run.displayTitle,
  ]);
  const widths = [0, 1, 2, 3].map(column => Math.max(0, ...rows.map(row => row[column]!.length)));
  return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n");
};
