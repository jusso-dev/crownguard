import type { FetchOutcome, FetchResult, Fetcher, RedirectHop } from "./types";
import { hostOf, isHttpUrl, limiter, sleep as defaultSleep } from "./util";

/** Identifies the watch honestly. No URL in it: cyber.gov.au's firewall resets connections whose user agent contains one. */
export const USER_AGENT = "Mozilla/5.0 (compatible; crownguard-source-watch/1.0)";

/** Hosts a redirect only reaches when a page wants a signed-in or consenting user: never a real page move. */
const SIGN_IN_HOSTS = new Set([
  "accounts.google.com",
  "consent.google.com",
  "consent.youtube.com",
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "signin.aws.amazon.com",
]);

/** Text in a body that marks a bot challenge or block page rather than the requested content. */
const CHALLENGE_MARKERS = [
  /<title>\s*Just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*Attention Required! \| Cloudflare\s*<\/title>/i,
  /cf-chl-|challenge-platform|cf_chl_opt/i,
  /<title>\s*Access Denied\s*<\/title>[\s\S]{0,2000}Reference\s*#/i,
  /Request unsuccessful\. Incapsula incident ID/i,
  /<title>\s*(?:Sorry\.\.\.|Before you continue)/i,
  /\bunusual traffic from your computer network\b/i,
];

const TEXT_TYPES = /^(?:text\/|application\/(?:xhtml\+xml|xml|atom\+xml|rss\+xml|json|ld\+json))/i;

export interface FetcherOptions {
  /** Per-host request concurrency. */
  concurrencyFor?: (host: string) => number;
  /** Per-host pause after each request, in milliseconds (robots.txt crawl-delay). */
  delayFor?: (host: string) => number;
  /** Per-host retries; falls back to `retries`. */
  retriesFor?: (host: string) => number | undefined;
  timeoutMs?: number;
  /** Extra attempts after a network error, 5xx or 429. */
  retries?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const {
    concurrencyFor = () => 4,
    delayFor = () => 0,
    retriesFor = () => undefined,
    timeoutMs = 30_000,
    retries = 2,
    maxRedirects = 10,
    maxBytes = 20 * 1024 * 1024,
    userAgent = USER_AGENT,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;
  const limits = new Map<string, ReturnType<typeof limiter>>();
  const limitFor = (host: string) => {
    let l = limits.get(host);
    if (!l) limits.set(host, (l = limiter(Math.max(1, concurrencyFor(host)))));
    return l;
  };

  async function once(url: string, accept: string): Promise<FetchResult & { retryAfterMs?: number }> {
    const started = Date.now();
    const redirects: RedirectHop[] = [];
    let current = url;
    const result = (outcome: FetchOutcome, status: number, extra: Partial<FetchResult> = {}) => ({
      requestedUrl: url,
      finalUrl: current,
      redirects,
      status,
      outcome,
      elapsedMs: Date.now() - started,
      ...extra,
    });

    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isHttpUrl(current)) return result("http-error", 0, { error: "redirected to a non-http URL" });
      if (SIGN_IN_HOSTS.has(hostOf(current))) return result("challenge", 0, { error: `redirected to sign-in (${hostOf(current)})` });
      let res: Response;
      try {
        res = await fetchImpl(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": userAgent, accept, "accept-language": "en-US,en;q=0.9" },
        });
      } catch (e) {
        const err = e as Error & { cause?: { code?: string; message?: string } };
        const reason = err.name === "TimeoutError" ? `timed out after ${timeoutMs / 1000}s` : (err.cause?.code ?? err.cause?.message ?? err.message);
        return result("network", 0, { error: reason });
      }

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        redirects.push({ url: current, status: res.status });
        try {
          current = new URL(location, current).href;
        } catch {
          return result("http-error", res.status, { error: "invalid redirect location" });
        }
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        return result("http-error", res.status, { contentType, error: `body larger than ${maxBytes} bytes` });
      }
      let body: string | undefined;
      let bytes: Uint8Array | undefined;
      try {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) return result("http-error", res.status, { contentType, error: `body larger than ${maxBytes} bytes` });
        if (TEXT_TYPES.test(contentType) || (!contentType && !looksBinary(buf))) body = new TextDecoder().decode(buf);
        else bytes = buf;
      } catch (e) {
        return result("network", res.status, { contentType, error: `body read failed: ${(e as Error).message}` });
      }

      const s = res.status;
      // Challenge pages come with an error status; normal pages on some sites embed Cloudflare's detection script.
      const challenged =
        res.headers.get("cf-mitigated") === "challenge" || (s >= 400 && body !== undefined && CHALLENGE_MARKERS.some((re) => re.test(body.slice(0, 50_000))));
      let outcome: FetchOutcome;
      if (challenged) outcome = "challenge";
      else if (s >= 200 && s < 300) outcome = "ok";
      else if (s === 404 || s === 410) outcome = "not-found";
      else if (s === 429 || s >= 500) outcome = "server-error";
      else outcome = "http-error";
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      return {
        ...result(outcome, s, { contentType, body, bytes, ...(outcome === "ok" ? {} : { error: challenged ? "bot challenge" : `HTTP ${s}` }) }),
        ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
      };
    }
    return result("http-error", 0, { error: `more than ${maxRedirects} redirects` });
  }

  return {
    fetchPage(url, { accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } = {}) {
      const host = hostOf(url);
      const allowed = retriesFor(host) ?? retries;
      return limitFor(host)(async () => {
        let attempt = 0;
        for (;;) {
          const { retryAfterMs, ...r } = await once(url, accept);
          const transient = r.outcome === "network" || r.outcome === "server-error";
          if (!transient || attempt >= allowed) {
            // Holding the host's slot during the pause spaces requests out.
            const pause = delayFor(host);
            if (pause) await sleep(pause);
            return r;
          }
          attempt++;
          await sleep(Math.min(retryAfterMs ?? 1000 * 2 ** attempt, 30_000));
        }
      });
    },
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.byteLength, 512);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
