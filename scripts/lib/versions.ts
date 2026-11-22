/** Compare dotted version numbers part by part (`1.10.0` > `1.9.9`, `2` = `2.0`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const TAG = /^v?\d+(?:\.\d+){1,3}$/;

/** True for a plain version tag: `5.47.0`, `v1.1.0`, `v2026.09.4`. Pre-release suffixes are not tags we follow. */
export const isTag = (tag: string): boolean => TAG.test(tag);

/** Compare two release tags (`v2026.10.15` > `v2026.09.4`). Throws on anything that isn't a tag. */
export function compareTags(a: string, b: string): number {
  if (!isTag(a) || !isTag(b)) throw new Error(`cannot compare ${a} with ${b}: not version tags`);
  return Math.sign(compareVersions(a.replace(/^v/, ""), b.replace(/^v/, "")));
}
