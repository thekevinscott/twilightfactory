import { constants, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The Claude Agent SDK looks up its native binary in node_modules on every query, so reinstalling
// node_modules under a running tf breaks Claude (#54). Hand the bridge a link pnpm can't remove.
// It sits next to node_modules so the hard link stays on one filesystem.
const cacheDir = path.resolve(import.meta.dirname, "../.cache");

const installedBinary = (): string | undefined => {
  const bridge = createRequire(createRequire(import.meta.url).resolve("pi-claude-bridge/package.json"));
  const sdk = createRequire(bridge.resolve("@anthropic-ai/claude-agent-sdk"));
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const libc of ["", "-musl"]) {
    try {
      return sdk.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libc}/claude${suffix}`);
    } catch {
      // Not installed for this platform; try the next variant.
    }
  }
  return undefined;
};

export const stageClaudeExecutable = (): string | undefined => {
  try {
    const binary = installedBinary();
    if (!binary) { return undefined; }
    const { name, version } = JSON.parse(readFileSync(path.join(path.dirname(binary), "package.json"), "utf8"));
    const staged = path.join(cacheDir, `${name.replace("/", "+")}@${version}`, path.basename(binary));
    if (existsSync(staged)) { return staged; }
    mkdirSync(path.dirname(staged), { recursive: true });
    const partial = `${staged}.${process.pid}`;
    try {
      linkSync(binary, partial);
    } catch {
      copyFileSync(binary, partial, constants.COPYFILE_FICLONE);
    }
    renameSync(partial, staged);
    return staged;
  } catch {
    return undefined;
  }
};
