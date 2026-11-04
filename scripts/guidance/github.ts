import { isTag } from "./pins";

/** A published upstream release. `url` is built from the repo and tag, never taken from the API response. */
export interface Release {
  tag: string;
  /** Publication date, YYYY-MM-DD. */
  date: string;
  url: string;
}

export interface TreeEntry {
  path: string;
  type: string;
}

/** The few GitHub reads the updaters need. Unlike the source watch client, every miss throws: a half-read release must not become a commit. */
export interface GuidanceGitHub {
  /** The repo's latest release (GitHub skips drafts and pre-releases). */
  latestRelease(repo: string): Promise<Release>;
  /** Entries of one directory at a ref. */
  dir(repo: string, path: string, ref: string): Promise<{ name: string; path: string; type: string; sha: string }[]>;
  /** Every entry under a tree, paths relative to it. Throws when GitHub truncated the listing. */
  tree(repo: string, sha: string): Promise<TreeEntry[]>;
  /** File text at a ref. */
  raw(repo: string, ref: string, path: string): Promise<string>;
}

export interface GuidanceGitHubOptions {
  /** Token for api.github.com (GITHUB_TOKEN in Actions). Without one the API allows 60 requests an hour, which is enough. */
  token?: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  rawBase?: string;
}

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const releaseUrl = (repo: string, tag: string) => `https://github.com/${repo}/releases/tag/${tag}`;

export function createGuidanceGitHub(opts: GuidanceGitHubOptions = {}): GuidanceGitHub {
  const { token, fetchImpl = fetch, apiBase = "https://api.github.com", rawBase = "https://raw.githubusercontent.com" } = opts;

  const check = (repo: string, ref?: string, path?: string) => {
    if (!REPO.test(repo)) throw new Error(`not a GitHub repo: ${repo}`);
    if (ref !== undefined && !REF.test(ref)) throw new Error(`not a ref: ${ref}`);
    if (path !== undefined && (path.includes("..") || path.startsWith("/"))) throw new Error(`not a repo path: ${path}`);
  };

  async function get(url: string, headers: Record<string, string>): Promise<Response> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "crownguard-guidance-update", ...headers } });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${url}: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  async function api<T>(path: string): Promise<T> {
    const res = await get(`${apiBase}${path}`, {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    });
    return (await res.json()) as T;
  }

  return {
    async latestRelease(repo) {
      check(repo);
      const r = await api<{ tag_name?: unknown; published_at?: unknown }>(`/repos/${repo}/releases/latest`);
      const tag = typeof r.tag_name === "string" ? r.tag_name : "";
      if (!isTag(tag)) throw new Error(`${repo}: latest release tag ${JSON.stringify(r.tag_name)} is not a version tag`);
      const date = typeof r.published_at === "string" ? r.published_at.slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${repo}: release ${tag} has no publication date`);
      return { tag, date, url: releaseUrl(repo, tag) };
    },
    async dir(repo, path, ref) {
      check(repo, ref, path);
      const entries = await api<unknown>(`/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
      if (!Array.isArray(entries)) throw new Error(`${repo}/${path} at ${ref} is not a directory`);
      return entries as { name: string; path: string; type: string; sha: string }[];
    },
    async tree(repo, sha) {
      check(repo);
      if (!SHA.test(sha)) throw new Error(`not a tree sha: ${sha}`);
      const t = await api<{ truncated?: boolean; tree?: TreeEntry[] }>(`/repos/${repo}/git/trees/${sha}?recursive=1`);
      if (t.truncated) throw new Error(`${repo}: GitHub truncated tree ${sha}; read it in parts`);
      return (t.tree ?? []).map((e) => ({ path: e.path, type: e.type }));
    },
    async raw(repo, ref, path) {
      check(repo, ref, path);
      const res = await get(`${rawBase}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`, {});
      return res.text();
    },
  };
}
