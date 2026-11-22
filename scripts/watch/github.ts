import { createHash } from "node:crypto";
import { API_BASE, apiHeaders, isRepo, rawUrl } from "../lib/github";
import type { Commit } from "./types";
import { collapse, readCapped, truncate } from "./util";

interface GitHubOptions {
  /** Token for api.github.com (GITHUB_TOKEN in Actions). Without one the API allows 60 requests an hour. */
  token?: string;
  fetchImpl?: typeof fetch;
  /** Largest API response or raw file read; anything bigger is treated as a miss. */
  maxBytes?: number;
}

/** Most API calls one run may make; raw file downloads don't count. */
const MAX_CALLS = 400;
const USER_AGENT = "crownguard-source-watch";

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

/** Learn mirror branches can contain slashes. */
const REF = /^[A-Za-z0-9._/-]+$/;

export function createGitHub(opts: GitHubOptions = {}): GitHub {
  const { token, fetchImpl = fetch, maxBytes = 20 * 1024 * 1024 } = opts;
  let calls = 0;
  let limited: string | undefined;

  async function api<T>(path: string): Promise<T | undefined> {
    if (limited) return undefined;
    if (calls >= MAX_CALLS) {
      limited = `GitHub API call budget of ${MAX_CALLS} reached`;
      return undefined;
    }
    calls++;
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, { signal: AbortSignal.timeout(30_000), headers: apiHeaders(USER_AGENT, token) });
    } catch {
      // Network errors are misses: every caller already copes with a mirror it can't read.
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
    try {
      const buf = await readCapped(res, maxBytes);
      return buf ? (JSON.parse(new TextDecoder().decode(buf)) as T) : undefined;
    } catch {
      // A truncated or non-JSON body is a miss like any other.
      return undefined;
    }
  }

  async function fileAt(repo: string, ref: string, path: string): Promise<string | undefined> {
    if (!isRepo(repo) || !REF.test(ref) || path.includes("..")) return undefined;
    try {
      const res = await fetchImpl(rawUrl(repo, ref, path), { signal: AbortSignal.timeout(30_000), headers: { "user-agent": USER_AGENT } });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return undefined;
      }
      const buf = await readCapped(res, maxBytes);
      return buf && new TextDecoder().decode(buf);
    } catch {
      // Network errors are misses: a mirror that can't be read just means no Markdown diff.
      return undefined;
    }
  }

  const repos = new Map<string, Promise<boolean>>();

  return {
    repoExists(repo) {
      if (!isRepo(repo)) return Promise.resolve(false);
      let known = repos.get(repo);
      if (!known) {
        known = api<{ private?: boolean }>(`/repos/${repo}`).then((r) => !!r && r.private === false);
        repos.set(repo, known);
      }
      return known;
    },
    fileAt,
    async commitsBetween(repo, path, since, until) {
      if (!isRepo(repo) || !REF.test(until)) return undefined;
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
    // A comment is stripped to its close, or to the end of the text when a page leaves one open. Stripping only
    // complete comments would leave the opening `<!--` behind, which is what an injection would then ride on.
    .replace(/<!--(?:(?!-->)[\s\S])*(?:-->|$)/g, "")
    .split(/\r?\n/)
    .map((l) => collapse(l))
    .filter(Boolean)
    .join("\n");
}

/** Link to the file's diff inside GitHub's compare view (the anchor is the SHA-256 of the path). */
export function compareUrl(repo: string, since: string, until: string, path: string): string {
  return `https://github.com/${repo}/compare/${since}...${until}#diff-${createHash("sha256").update(path).digest("hex")}`;
}
