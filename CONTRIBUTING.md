# Contributing

Thanks for helping. The most valuable contributions are to the **content**: better questions, clearer
explanations, fresher sources and accurate framework mappings. You don't need to write code for that.

## Setup

```sh
pnpm install
pnpm dev                 # http://localhost:5173
```

## Changing questions or crown-jewel categories

1. Read [docs/content-guide.md](docs/content-guide.md).
2. Edit the YAML under `content/`.
3. Run `pnpm validate:content`. It catches unknown ids, missing sources, bad framework references and
   asset types with no questions.
4. Open a pull request. Say which guidance page backs the change and link it.

Cited pages are re-checked every night. When guidance breaks, moves, retires or changes, the source watch opens a pull
request listing what to review ([how it works](docs/content-guide.md#source-watch)).

Rules that keep the content trustworthy:

- Every question cites at least one page of the vendor's own guidance (Microsoft Learn, Google Workspace
  Admin Help, Google Cloud docs). Government and standards sources are welcome in addition.
- CIS Benchmarks are licensed CC BY-NC-SA 4.0. Record recommendation numbers and short titles only.
  Never paste audit or remediation text from a benchmark.
- Use Australian/British spelling (organisation, licence) for consistency.
- Keep questions answerable by an IT lead without running scripts.

## Changing code

```sh
pnpm lint && pnpm typecheck && pnpm test   # unit tests (engine, colours, content)
pnpm exec playwright install chromium
pnpm test:e2e                               # full journeys against the production build
```

To look at the report without clicking through the app, render a sample PDF from fixture data:

```sh
SAMPLE_OUT=/tmp/crownguard-sample.pdf pnpm vitest run src/report/sample.test.ts
```

The scoring rules live in `src/engine/` and are covered by `src/engine/engine.test.ts`. If you change
them, update the method section in `src/report/Document.tsx` and the README so the published method
always matches the code.

## Privacy is a feature

crownguard must never send assessment data anywhere. Don't add analytics, remote fonts, CDNs or any
network calls. `e2e/privacy.spec.ts` fails if the app makes a request to another origin.
