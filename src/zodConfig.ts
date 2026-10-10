import { z } from "zod";

/** Zod's schema JIT uses `new Function` (blocked by CSP `script-src` without `'unsafe-eval'`). */
z.config({ jitless: true });
