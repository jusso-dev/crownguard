import { loadCatalogue } from "../src/content/loader";
import { readContentFiles } from "./read-content";

const { catalogue } = loadCatalogue(readContentFiles());
const failures: string[] = [];

await Promise.all(
  [...catalogue.sources.values()].map(async (s) => {
    try {
      const res = await fetch(s.url, { method: "GET", redirect: "follow", headers: { "user-agent": "crownguard-link-check" } });
      if (res.status >= 400) failures.push(`${s.id}: HTTP ${res.status} ${s.url}`);
    } catch (e) {
      failures.push(`${s.id}: ${(e as Error).message} ${s.url}`);
    }
  }),
);

console.log(`checked ${catalogue.sources.size} sources`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
