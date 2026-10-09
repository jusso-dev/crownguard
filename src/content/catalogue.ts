import { contentDigest, loadCatalogue, type ContentFiles } from "./loader";

const files = import.meta.glob("/content/**/*.yaml", { query: "?raw", import: "default", eager: true }) as ContentFiles;
const { catalogue: loaded, errors } = loadCatalogue(files);
if (errors.length) throw new Error(`Invalid content:\n${errors.join("\n")}`);

export const catalogue = loaded;

/** Digest of the questions and frameworks in this build, stamped into saved files. */
export const contentHash = contentDigest(loaded);
