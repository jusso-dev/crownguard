import { createHash } from "node:crypto";
import type { Commit } from "./types";
import { collapse, truncate } from "./util";

export interface GitHubOptions {
  /** Token for api.github.com (GITHUB_TOKEN in Actions). Without one the API allows 60 requests an hour. */
  token?: string;
  /** Most API calls one run may make; raw file downloads don't count. */
  maxCalls?: number;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  rawBase?: string;
}

/**
 * Read access to the public MicrosoftDocs mirrors behind some Microsoft Learn pages. Most Learn repos have no public
 * mirror (only entra-docs, azure-docs and power-platform did in October 2026), so every call tolerates a miss.
 */
export interface GitHub {
  /** True when the repo exists and is public. Answers are cached for the run. */
  repoExists(repo: string): Promise<boolean>;
  /** File text at a commit, or undefined when it doesn't exist or can't be fetched. */
  fileAt(repo: string, ref: string, path: string): Promise<string | undefined>;
  /** Commits that changed `path` after `since`, up to and including `until`, newest first (at most 20). */
  commitsBetween(repo: string, path: string, since: string, until: string): Promise<Commit[] | undefined>;
  calls(): number;
  /** Why API work was cut short, if it was (rate limit or call budget). */
  limited(): string | undefined;
}

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9._/-]+$/;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function createGitHub(opts: GitHubOptions = {}): GitHub {
  const { token, maxCalls = 400, fetchImpl = fetch, apiBase = "https://api.github.com", rawBase = "https://raw.githubusercontent.com" } = opts;
  let calls = 0;
  let limited: string | undefined;

  async function api<T>(path: string): Promise<T | undefined> {
    if (limited) return undefined;
    if (calls >= maxCalls) {
      limited = `GitHub API call budget of ${maxCalls} reached`;
      return undefined;
    }
    calls++;
    let res: Response;
    try {
      res = await fetchImpl(`${apiBase}${path}`, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "crownguard-source-watch",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      return undefined;
    }
    if ((res.status === 403 || res.status === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"))) {
      limited = `GitHub API rate limit reached (resets ${res.headers.get("x-ratelimit-reset") ? new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000).toISOString() : "later"})`;
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    return (await res.json()) as T;
  }

  async function fileAt(repo: string, ref: string, path: string): Promise<string | undefined> {
    if (!REPO.test(repo) || !REF.test(ref) || path.includes("..")) return undefined;
    try {
      const res = await fetchImpl(`${rawBase}/${repo}/${encodePath(ref)}/${encodePath(path)}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { "user-agent": "crownguard-source-watch" },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return undefined;
      }
      return await res.text();
    } catch {
      return undefined;
    }
  }

  const repos = new Map<string, Promise<boolean>>();

  return {
    repoExists(repo) {
      if (!REPO.test(repo)) return Promise.resolve(false);
      let known = repos.get(repo);
      if (!known) {
        known = api<{ private?: boolean }>(`/repos/${repo}`).then((r) => !!r && r.private === false);
        repos.set(repo, known);
      }
      return known;
    },
    fileAt,
    async commitsBetween(repo, path, since, until) {
      if (!REPO.test(repo) || !REF.test(until)) return undefined;
      type C = { sha: string; html_url: string; commit: { message: string; committer?: { date?: string }; author?: { date?: string } } };
      const list = await api<C[]>(`/repos/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(until)}&per_page=20`);
      if (!list) return undefined;
      const out: Commit[] = [];
      for (const c of list) {
        if (c.sha === since) break;
        out.push({
          sha: c.sha,
          date: (c.commit.committer?.date ?? c.commit.author?.date ?? "").slice(0, 10),
          message: truncate(collapse(c.commit.message.split("\n")[0] ?? ""), 160),
          url: c.html_url,
        });
      }
      return out;
    },
    calls: () => calls,
    limited: () => limited,
  };
}

/**
 * Learn Markdown reduced to comparable text: no front matter (dates and authors churn), no HTML comments, one
 * trimmed non-empty line per source line.
 */
export function markdownBody(markdown: string): string {
  return markdown
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((l) => collapse(l))
    .filter(Boolean)
    .join("\n");
}

/** Link to the file's diff inside GitHub's compare view (the anchor is the SHA-256 of the path). */
export function compareUrl(repo: string, since: string, until: string, path: string): string {
  return `https://github.com/${repo}/compare/${since}...${until}#diff-${createHash("sha256").update(path).digest("hex")}`;
}
