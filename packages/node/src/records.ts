import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { TableDef } from "dirsql";
import { DirSQL } from "dirsql";
import writeFileAtomic from "write-file-atomic";

export type Record_ = Record<string, unknown>;

export function newId(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ]/g, "").replace(".", "-");
  return `${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString("hex")}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function writeRecord(path: string, record: Record_): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic.sync(path, `${JSON.stringify(record, null, 2)}\n`);
}

export function readRecord(path: string): Record_ {
  return JSON.parse(readFileSync(path, "utf8")) as Record_;
}

const EVENTS = ["id TEXT PRIMARY KEY", "time TEXT", "kind TEXT", "head TEXT", "detail TEXT"];
const ACTION_RUNS = [
  "id TEXT PRIMARY KEY",
  "action TEXT",
  "command TEXT",
  "reason TEXT",
  "head TEXT",
  "started TEXT",
  "ended TEXT",
  "exit_code INTEGER",
  "error TEXT",
  "log TEXT",
];
const AGENT_RUNS = [
  "id TEXT PRIMARY KEY",
  "prompt TEXT",
  "worktree TEXT",
  "branch TEXT",
  "base TEXT",
  "started TEXT",
  "ended TEXT",
  "exit_code INTEGER",
  "error TEXT",
  "output TEXT",
];

const WORKFLOW_RUNS = [
  "id TEXT PRIMARY KEY",
  "name TEXT",
  "status TEXT",
  "conclusion TEXT",
  "head TEXT",
  "url TEXT",
  "created TEXT",
];

function table(root: string, name: string, columns: string[], glob: string): TableDef {
  const names = columns.map((column) => column.split(" ")[0] as string);
  return {
    name,
    ddl: `CREATE TABLE ${name} (${columns.join(", ")})`,
    glob,
    onFile: (path: string) => {
      try {
        const record = readRecord(isAbsolute(path) ? path : join(root, path));
        return [Object.fromEntries(names.map((column) => [column, record[column] ?? null]))];
      } catch {
        return [];
      }
    },
  };
}

export function openTables(root: string): DirSQL {
  mkdirSync(root, { recursive: true });
  return new DirSQL({
    root,
    tables: [
      table(root, "events", EVENTS, "events/*.json"),
      table(root, "action_runs", ACTION_RUNS, "actions/*/run.json"),
      table(root, "agent_runs", AGENT_RUNS, "agents/*/run.json"),
      table(root, "workflow_runs", WORKFLOW_RUNS, "workflows/*.json"),
    ],
    noIgnore: true,
  });
}

const STATUS = (notRun: string) => `
  CASE
    WHEN ended IS NULL THEN 'running'
    WHEN exit_code = 0 THEN 'passed'
    WHEN exit_code IS NULL THEN '${notRun}'
    ELSE 'failed'
  END AS status`;

export const QUERIES = {
  events: "SELECT id, time, kind, head, detail FROM events ORDER BY id DESC LIMIT 50",
  actionRuns: `SELECT id, action, reason, head, started, ended, exit_code, error, log,
    ${STATUS("failed")} FROM action_runs ORDER BY started DESC, id DESC LIMIT 50`,
  agents: `SELECT id, prompt, worktree, branch, base, started, ended, exit_code, error, output,
    ${STATUS("not run")} FROM agent_runs ORDER BY id DESC LIMIT 50`,
  workflows: "SELECT id, name, status, conclusion, head, url, created FROM workflow_runs ORDER BY name",
  lastHead:
    "SELECT head FROM events WHERE kind IN ('head', 'watching') ORDER BY id DESC LIMIT 1",
  unfinishedActions: "SELECT id FROM action_runs WHERE ended IS NULL",
  unfinishedAgents: "SELECT id FROM agent_runs WHERE ended IS NULL",
};
