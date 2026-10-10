# Self-hosting

crownguard is a static site. Build with `pnpm build` and serve `dist/` from any static host. Set `BASE_PATH` when the app lives under a sub-path (the GitHub Pages workflow uses `/crownguard/`).

## Security headers

GitHub Pages cannot send custom response headers, so the production build also embeds the Content-Security-Policy and referrer policy as `<meta>` tags. On a host that *can* send headers, send the full set below (including `frame-ancestors 'none'` and `Cross-Origin-Opener-Policy`, which only work as headers).

These values are exported as `securityHeaders` from `vite.config.ts`. A unit test checks this document still contains every directive so the snippets cannot drift.

### nginx

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types default; frame-ancestors 'none'" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

### Cloudflare Pages (`_headers`)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types default; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
```

### Netlify (`_headers`)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types default; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
```

## Dedicated origin

Assessment progress in `localStorage` is per origin. A dedicated hostname (or a Pages custom domain that is not shared with other sites) is recommended so other apps cannot read the key.

No custom domain is configured for the public GitHub Pages deploy yet; production remains at `https://jusso-dev.github.io/crownguard/` until the owner chooses one.

### Optional migration banner

Build with `VITE_CANONICAL_ORIGIN` set to the new origin (for example `https://crownguard.example`). When that build is still served from the legacy origin `https://jusso-dev.github.io`, the app shows a banner: this address shares an origin with other sites — save a file, then open the new address. The legacy page cannot read the new origin's storage (and must not try).

Leave `VITE_CANONICAL_ORIGIN` unset (the default, including CI) for no banner and no behaviour change.

## Related

- [Threat model](./threat-model.md) — what is stored where and who can read it
- [File format](./file-format.md) — saved `.crownguard.json` shape (plain or encrypted envelope)
