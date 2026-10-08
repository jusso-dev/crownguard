import { loadCatalogue } from "../src/content/loader";
import { readContentFiles } from "./read-content";

const { catalogue, errors } = loadCatalogue(readContentFiles());
for (const [id, b] of catalogue.platforms)
  console.log(`${id}: ${b.assetTypes.length} asset types, ${b.questions.length} questions`);
console.log(`${catalogue.frameworks.size} frameworks, ${catalogue.sources.size} sources`);
if (errors.length) {
  console.error(`\n${errors.length} content error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("content OK");
