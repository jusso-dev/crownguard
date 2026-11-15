import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";

const candidate = resolve(import.meta.dirname, "../..");

/** Only private fixture paths are passed here, never paths supplied by an artifact. */
export function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export type Tree = Record<string, string>;

/** Real entrypoints and imports, copied from the current candidate, with synthetic outputs. */
export function applyCliSandbox() {
  const parent = mkdtempSync(join(tmpdir(), "crownguard-apply-cli-"));
  const root = join(parent, "checkout");
  const artifacts = join(parent, "artifacts");
  const scratch = join(parent, "scratch");
  const cleanup = () => {
    rmSync(parent, { recursive: true, force: true });
    if (existsSync(parent)) throw new Error(`Sandbox cleanup failed: ${parent}`);
  };
  try {
    for (const path of [root, artifacts, scratch]) mkdirSync(path);
    for (const dir of ["scripts", "src"]) {
      cpSync(join(candidate, dir), join(root, dir), {
        recursive: true,
        filter: (path) => {
          const parts = relative(candidate, path).split("/");
          if (parts.includes("fixtures") || /\.(test|spec)\./.test(path)) return false;
          const stat = lstatSync(path);
          return !stat.isSymbolicLink() && (stat.isDirectory() || [".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(path)));
        },
      });
    }
    cpSync(join(candidate, "package.json"), join(root, "package.json"));
    symlinkSync(join(candidate, "node_modules"), join(root, "node_modules"), "dir");
    put(join(parent, "sibling.txt"), "outside copied checkout\n");
    put(join(root, "unrelated.txt"), "keep unrelated destination\n");
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    root, artifacts, cleanup,
    run(kind: "watch" | "guidance", args: string[] = [artifacts]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts", kind, "apply-cli.ts"), ...args], {
        cwd: root,
        env: { HOME: scratch, TMPDIR: scratch, TSX_DISABLE_CACHE: "1" },
        encoding: "utf8",
        timeout: 15_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.signal || result.status === null) throw new Error(`CLI did not exit normally: ${result.signal}`);
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    snapshot(): Tree {
      const tree: Tree = {};
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          // Neither snapshots nor cleanup follow the sole dependency link.
          if (path === scratch || path === join(root, "node_modules")) continue;
          const key = relative(parent, path);
          if (entry.isSymbolicLink()) tree[key] = `link:${readlinkSync(path)}`;
          else if (entry.isDirectory()) {
            tree[key] = "directory";
            walk(path);
          } else tree[key] = `file:${readFileSync(path).toString("base64")}`;
        }
      };
      walk(parent);
      return tree;
    },
  };
}

/** Expected bytes supplied by each test, without using production writers or schemas. */
export function withFiles(before: Tree, files: Record<string, string>): Tree {
  return { ...before, ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path, `file:${Buffer.from(text).toString("base64")}`])) };
}
