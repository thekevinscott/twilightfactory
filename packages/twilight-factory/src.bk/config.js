import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
export const CONFIG_FILE = "twilightfactory.toml";
const Reason = z.enum(["head", "timer", "manual"]);
const Action = z.strictObject({
    name: z.string().min(1),
    command: z.string().min(1),
    on: z.array(Reason).default(["manual"]),
});
const Agent = z.strictObject({
    prompt_file: z.string().optional(),
    dockerfile: z.string().optional(),
    allow: z.array(z.string()).default([]),
    timeout_seconds: z.number().positive().optional(),
    memory: z.string().optional(),
    model: z.string().optional(),
});
const Config = z.strictObject({
    remote: z.string().default("origin"),
    branch: z.string().optional(),
    poll_seconds: z.number().positive().default(60),
    timer_seconds: z.number().positive().optional(),
    action: z.array(Action).default([]),
    agent: Agent.default({ allow: [] }),
});
export function loadConfig(root) {
    const path = join(root, CONFIG_FILE);
    const found = existsSync(path) ? parse(readFileSync(path, "utf8")) : {};
    const config = Config.parse(found);
    const names = config.action.map((action) => action.name);
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    if (repeated !== undefined) {
        throw new Error(`${CONFIG_FILE}: action "${repeated}" is defined twice`);
    }
    return config;
}
