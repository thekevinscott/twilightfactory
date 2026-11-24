import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface Commit {
  oid: string;
  committedDate: string;
}

interface Ref {
  name: string;
  // An annotated tag points at a tag object, which points at the commit.
  target: Commit | { target: Commit };
}

const query = `
query($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/green/", first: $limit, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes {
        name
        target {
          ... on Commit { oid committedDate }
          ... on Tag { target { ... on Commit { oid committedDate } } }
        }
      }
    }
  }
}`;

export const recentTags = async (limit: number): Promise<string> => {
  const { stdout } = await promisify(execFile)("gh", [
    "api", "graphql", "-f", `query=${query}`, "-F", "owner={owner}", "-F", "name={repo}", "-F", `limit=${limit}`,
  ]);
  const refs = (JSON.parse(stdout) as { data: { repository: { refs: { nodes: Ref[] } } } }).data.repository.refs.nodes;
  const rows = refs.map(ref => {
    const commit = "target" in ref.target ? ref.target.target : ref.target;
    return [`green/${ref.name}`, commit.committedDate, commit.oid];
  });
  const widths = [0, 1].map(column => Math.max(0, ...rows.map(row => row[column]!.length)));
  return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ")).join("\n");
};
