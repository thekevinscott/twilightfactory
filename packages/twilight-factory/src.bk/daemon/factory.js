import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";
import { loadConfig } from "../config.js";
import { recordsFolder } from "../paths.js";
import { newId, now, openTables, QUERIES, readRecord, writeRecord } from "../records.js";
import { git, remoteHead } from "../repo.js";
const BOTBOX_MISSING = "not run: botbox has no command line entry point, so the daemon stopped after creating the worktree";
const GH_FIELDS = "workflowDatabaseId,workflowName,status,conclusion,headSha,url,createdAt";
const GH_MIN_SECONDS = 60;
function message(error) {
    const found = error;
    const text = [found.stderr, found.shortMessage, found.message].find((part) => typeof part === "string" && part.trim() !== "");
    return typeof text === "string" ? text.trim() : String(error);
}
export class Factory {
    root;
    records;
    listeners = new Set();
    db;
    stopping = new AbortController();
    config;
    branch = null;
    head = null;
    problem = null;
    workflowsNote = null;
    workflowsChecked = 0;
    workflowsWritten = new Map();
    queue = Promise.resolve();
    constructor(root) {
        this.root = root;
        this.records = recordsFolder(root);
        this.db = openTables(this.records);
        this.config = loadConfig(root);
    }
    async start() {
        await this.db.ready;
        this.endUnfinished("actions", await this.db.query(QUERIES.unfinishedActions));
        this.endUnfinished("agents", await this.db.query(QUERIES.unfinishedAgents));
        const [last] = await this.db.query(QUERIES.lastHead);
        this.head = typeof last?.head === "string" ? last.head : null;
        void this.follow();
        void this.watch();
    }
    stop() {
        this.stopping.abort();
        this.notify();
        this.db.close();
    }
    get closing() {
        return this.stopping.signal.aborted;
    }
    async snapshot() {
        const [events, actionRuns, agents, workflows] = await Promise.all([
            this.db.query(QUERIES.events),
            this.db.query(QUERIES.actionRuns),
            this.db.query(QUERIES.agents),
            this.db.query(QUERIES.workflows),
        ]);
        return {
            repo: basename(this.root),
            root: this.root,
            state: this.records,
            remote: this.config.remote,
            branch: this.branch,
            head: this.head,
            problem: this.problem,
            poll_seconds: this.config.poll_seconds,
            timer_seconds: this.config.timer_seconds ?? null,
            actions: this.config.action,
            events: events,
            action_runs: actionRuns,
            agents: agents,
            workflows: this.workflowsNote ? [] : workflows,
            workflows_note: this.workflowsNote,
        };
    }
    runAction(name, reason) {
        const action = this.config.action.find((found) => found.name === name);
        if (!action) {
            throw new Error(`no action named "${name}" in twilightfactory.toml`);
        }
        const id = newId();
        void this.execute(id, action.name, action.command, reason);
        return id;
    }
    async startAgent(typed) {
        const prompt = typed.trim() || this.defaultPrompt();
        if (!prompt) {
            throw new Error("no prompt given and no [agent] prompt_file in twilightfactory.toml");
        }
        const id = newId();
        const folder = join(this.records, "agents", id);
        const worktree = join(this.root, ".worktrees", `agent-${id}`);
        const branch = `twilightfactory/agent-${id}`;
        await this.ignoreWorktrees();
        const base = await this.freshBase();
        await git(this.root, ["worktree", "add", "-b", branch, worktree, base]);
        const started = now();
        writeRecord(join(folder, "run.json"), {
            id,
            prompt,
            worktree,
            branch,
            base,
            started,
            ended: started,
            exit_code: null,
            error: BOTBOX_MISSING,
            output: join(folder, "output"),
        });
        this.event("agent", base, `worktree ${worktree}`);
        return id;
    }
    logPath(kind, id) {
        const path = join(this.records, kind, id, "run.json");
        if (!/^[\w-]+$/.test(id) || !existsSync(path)) {
            return null;
        }
        return path;
    }
    defaultPrompt() {
        const file = this.config.agent.prompt_file;
        return file ? readFileSync(join(this.root, file), "utf8").trim() : "";
    }
    async ignoreWorktrees() {
        const ignored = await execa("git", ["check-ignore", "-q", ".worktrees/x"], {
            cwd: this.root,
            reject: false,
        });
        if (ignored.exitCode === 0) {
            return;
        }
        const exclude = await git(this.root, ["rev-parse", "--git-path", "info/exclude"]);
        appendFileSync(join(this.root, exclude), "\n.worktrees/\n");
    }
    async freshBase() {
        try {
            const { branch } = await remoteHead(this.root, this.config.remote, this.config.branch);
            await git(this.root, ["fetch", this.config.remote, branch]);
            return await git(this.root, ["rev-parse", "FETCH_HEAD"]);
        }
        catch {
            return await git(this.root, ["rev-parse", "HEAD"]);
        }
    }
    endUnfinished(kind, rows) {
        for (const row of rows) {
            const path = join(this.records, kind, String(row.id), "run.json");
            writeRecord(path, { ...readRecord(path), ended: now(), error: "daemon stopped" });
        }
    }
    event(kind, head, detail) {
        const id = newId();
        writeRecord(join(this.records, "events", `${id}.json`), {
            id,
            time: now(),
            kind,
            head,
            detail,
        });
    }
    notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }
    async watch() {
        try {
            for await (const _ of this.db.watch()) {
                this.notify();
            }
        }
        catch (error) {
            if (!this.closing) {
                process.stderr.write(`dirsql watch ended: ${message(error)}\n`);
            }
        }
    }
    async follow() {
        let timerFrom = Date.now();
        while (!this.closing) {
            await this.poll();
            const timer = this.config.timer_seconds;
            let wait = this.config.poll_seconds * 1000;
            if (timer !== undefined) {
                const left = timerFrom + timer * 1000 - Date.now();
                if (left <= 0) {
                    timerFrom = Date.now();
                    this.trigger("timer");
                }
                wait = Math.min(wait, Math.max(left, 0) || timer * 1000);
            }
            await sleep(wait, undefined, { signal: this.stopping.signal }).catch(() => { });
        }
    }
    async poll() {
        try {
            this.config = loadConfig(this.root);
            const found = await remoteHead(this.root, this.config.remote, this.config.branch);
            const before = this.head;
            this.branch = found.branch;
            this.head = found.head;
            this.problem = null;
            if (before === null) {
                this.event("watching", found.head, `${this.config.remote}/${found.branch}`);
            }
            else if (before !== found.head) {
                this.event("head", found.head, `${before.slice(0, 7)} -> ${found.head.slice(0, 7)}`);
                this.trigger("head");
            }
        }
        catch (error) {
            const text = message(error);
            if (text !== this.problem) {
                this.event("error", null, text);
            }
            this.problem = text;
        }
        const every = Math.max(this.config.poll_seconds, GH_MIN_SECONDS) * 1000;
        if (this.branch && Date.now() - this.workflowsChecked >= every) {
            this.workflowsChecked = Date.now();
            await this.pollWorkflows(this.branch);
        }
        this.notify();
    }
    async pollWorkflows(branch) {
        try {
            const { stdout } = await execa("gh", ["run", "list", "--branch", branch, "--limit", "50", "--json", GH_FIELDS], { cwd: this.root, stdin: "ignore", timeout: 30_000, cancelSignal: this.stopping.signal });
            const latest = new Map();
            for (const run of JSON.parse(stdout)) {
                const id = String(run.workflowDatabaseId);
                if (!latest.has(id)) {
                    latest.set(id, {
                        id,
                        name: run.workflowName,
                        status: run.status,
                        conclusion: run.conclusion || null,
                        head: run.headSha,
                        url: run.url,
                        created: run.createdAt,
                    });
                }
            }
            for (const [id, run] of latest) {
                const text = JSON.stringify(run);
                if (this.workflowsWritten.get(id) !== text) {
                    writeRecord(join(this.records, "workflows", `${id}.json`), { ...run });
                    this.workflowsWritten.set(id, text);
                }
            }
            this.workflowsNote = null;
        }
        catch (error) {
            const found = error;
            this.workflowsNote =
                found.code === "ENOENT" ? "gh is not installed" : (message(error).split(/\n|\. /)[0] ?? "");
        }
    }
    trigger(reason) {
        const actions = this.config.action.filter((action) => action.on.includes(reason));
        for (const action of actions) {
            const id = newId();
            this.queue = this.queue.then(() => this.execute(id, action.name, action.command, reason));
        }
    }
    async execute(id, action, command, reason) {
        const folder = join(this.records, "actions", id);
        const log = join(folder, "output.log");
        const record = {
            id,
            action,
            command,
            reason,
            head: this.head,
            started: now(),
            ended: null,
            exit_code: null,
            error: null,
            log,
        };
        writeRecord(join(folder, "run.json"), record);
        try {
            const result = await execa(command, {
                shell: true,
                cwd: this.root,
                reject: false,
                stdin: "ignore",
                stdout: { file: log, append: true },
                stderr: { file: log, append: true },
                cancelSignal: this.stopping.signal,
                env: { TWILIGHTFACTORY_HEAD: this.head ?? "", TWILIGHTFACTORY_TRIGGER: reason },
            });
            writeRecord(join(folder, "run.json"), {
                ...record,
                ended: now(),
                exit_code: result.exitCode ?? null,
                error: result.exitCode === undefined ? message(result) : null,
            });
        }
        catch (error) {
            writeRecord(join(folder, "run.json"), { ...record, ended: now(), error: message(error) });
        }
    }
}
