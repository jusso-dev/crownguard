import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFetcher } from "./fetch";

let server: Server;
let base = "";
const hits = new Map<string, number>();

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  "/ok": (_req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><title>OK</title></html>"),
  "/hop1": (_req, res) => res.writeHead(301, { location: "/hop2" }).end(),
  "/hop2": (_req, res) => res.writeHead(302, { location: `${base}/ok` }).end(),
  "/gone": (_req, res) => res.writeHead(410).end(),
  "/missing": (_req, res) => res.writeHead(404, { "content-type": "text/html" }).end("nope"),
  "/flaky": (req, res) => {
    const n = (hits.get(req.url!) ?? 0) + 1;
    hits.set(req.url!, n);
    if (n < 2) res.writeHead(503, { "retry-after": "0" }).end();
    else res.writeHead(200, { "content-type": "text/plain" }).end("fine");
  },
  "/down": (_req, res) => res.writeHead(500).end(),
  "/cf": (_req, res) => res.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" }).end("<title>Just a moment...</title>"),
  "/cf503": (_req, res) => res.writeHead(503, { "content-type": "text/html" }).end("<html><head><title>Just a moment...</title></head></html>"),
  "/cfjs": (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end('<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><p>Real page</p></html>'),
  "/signin": (_req, res) => res.writeHead(302, { location: "https://accounts.google.com/ServiceLogin?continue=x" }).end(),
  "/loop": (_req, res) => res.writeHead(302, { location: "/loop" }).end(),
  "/js": (_req, res) => res.writeHead(302, { location: "javascript:alert(1)" }).end(),
  "/pdf": (_req, res) => res.writeHead(200, { "content-type": "application/pdf" }).end(Buffer.from("%PDF-1.7\n\0binary")),
  "/ua": (req, res) => res.writeHead(200, { "content-type": "text/plain" }).end(`${req.headers["user-agent"]}|${req.headers["accept-language"]}`),
};

beforeAll(async () => {
  // Look the handler up in a Map keyed by path, so a request URL can never pick out a property that isn't a handler.
  const handlers = new Map(Object.entries(routes));
  server = createServer((req, res) => (handlers.get(req.url!.split("?")[0]) ?? handlers.get("/missing")!)(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const fetcher = () => createFetcher({ sleep: async () => {}, timeoutMs: 5000 });

describe("fetchPage", () => {
  it("follows redirects and records each hop", async () => {
    const r = await fetcher().fetchPage(`${base}/hop1`);
    expect(r.outcome).toBe("ok");
    expect(r.finalUrl).toBe(`${base}/ok`);
    expect(r.redirects).toEqual([
      { url: `${base}/hop1`, status: 301 },
      { url: `${base}/hop2`, status: 302 },
    ]);
    expect(r.body).toContain("<title>OK</title>");
  });

  it("classifies gone pages, persistent errors and retries transient ones", async () => {
    expect((await fetcher().fetchPage(`${base}/gone`)).outcome).toBe("not-found");
    expect((await fetcher().fetchPage(`${base}/missing`)).outcome).toBe("not-found");
    const flaky = await fetcher().fetchPage(`${base}/flaky`);
    expect(flaky.outcome).toBe("ok");
    expect(flaky.body).toBe("fine");
    const down = await fetcher().fetchPage(`${base}/down`);
    expect(down.outcome).toBe("server-error");
    expect(down.error).toBe("HTTP 500");
  });

  it("recognises bot challenges and sign-in walls", async () => {
    expect((await fetcher().fetchPage(`${base}/cf`)).outcome).toBe("challenge");
    expect((await fetcher().fetchPage(`${base}/cf503`)).outcome).toBe("challenge");
    expect((await fetcher().fetchPage(`${base}/cfjs`)).outcome).toBe("ok");
    const signin = await fetcher().fetchPage(`${base}/signin`);
    expect(signin.outcome).toBe("challenge");
    expect(signin.error).toMatch(/sign-in/);
  });

  it("stops redirect loops and non-http redirects", async () => {
    expect((await fetcher().fetchPage(`${base}/loop`)).error).toMatch(/more than 10 redirects/);
    expect((await fetcher().fetchPage(`${base}/js`)).error).toMatch(/non-http/);
  });

  it("keeps binary bodies as bytes", async () => {
    const r = await fetcher().fetchPage(`${base}/pdf`);
    expect(r.body).toBeUndefined();
    expect(r.bytes?.byteLength).toBeGreaterThan(5);
  });

  it("reports network failures", async () => {
    const r = await createFetcher({ retries: 0, timeoutMs: 2000 }).fetchPage("http://127.0.0.1:1/");
    expect(r.outcome).toBe("network");
    expect(r.status).toBe(0);
  });

  it("identifies itself and asks for English", async () => {
    const r = await fetcher().fetchPage(`${base}/ua`);
    expect(r.body).toMatch(/^Mozilla\/5\.0 \(compatible; crownguard-source-watch\/1\.0\)\|en-US/);
  });
});
