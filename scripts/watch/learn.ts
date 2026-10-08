import { normalizeUrl } from "./util";

/** One entry of a Learn `toc.json`. Grouping entries have no URL. */
export interface TocNode {
  title: string;
  url?: string;
  children: TocNode[];
}

interface RawNode {
  toc_title?: unknown;
  href?: unknown;
  children?: unknown;
}

/**
 * Resolve a TOC href the way Learn does: relative to the toc.json URL, with the locale added to root-relative paths,
 * and without the `?toc=&bc=` breadcrumb parameters or fragments. Only learn.microsoft.com pages are kept.
 */
export function tocHref(href: string, tocUrl: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href, tocUrl);
  } catch {
    return undefined;
  }
  if (u.hostname !== "learn.microsoft.com" || u.protocol !== "https:") return undefined;
  if (!/^\/[a-z]{2}-[a-z]{2}\//i.test(u.pathname)) u.pathname = `/en-us${u.pathname}`;
  u.search = "";
  u.hash = "";
  if (u.pathname.endsWith("/toc.json")) return undefined;
  return normalizeUrl(u.toString());
}

export function parseToc(json: unknown, tocUrl: string): TocNode[] {
  const walk = (items: unknown): TocNode[] =>
    Array.isArray(items)
      ? items.map((raw: RawNode) => ({
          title: typeof raw.toc_title === "string" ? raw.toc_title : "",
          ...(typeof raw.href === "string" && tocHref(raw.href, tocUrl) ? { url: tocHref(raw.href, tocUrl) } : {}),
          children: walk(raw.children),
        }))
      : [];
  return walk((json as { items?: unknown })?.items);
}

export interface TocSection {
  /** Titles from the TOC root down to the section holding the page, e.g. `Plan and deploy > Conditional Access`. */
  path: string;
  /** Every page in that section (the page itself included), with titles. */
  pages: { url: string; title: string }[];
}

/** The TOC section that lists `pageUrl`: its parent's direct children. Undefined when the page isn't in the TOC. */
export function sectionOf(nodes: TocNode[], pageUrl: string): TocSection | undefined {
  const target = normalizeUrl(pageUrl);
  const find = (list: TocNode[], trail: string[]): TocSection | undefined => {
    if (list.some((n) => n.url === target))
      return {
        path: trail.join(" > ") || "(top)",
        pages: list.filter((n): n is TocNode & { url: string } => !!n.url).map((n) => ({ url: n.url, title: n.title })),
      };
    for (const n of list) {
      const hit = find(n.children, [...trail, n.title]);
      if (hit) return hit;
    }
    return undefined;
  };
  return find(nodes, []);
}

/** Where a page's table of contents lives, from its `toc_rel` meta. */
export function tocUrlFor(pageUrl: string, tocRel: string): string | undefined {
  try {
    const u = new URL(tocRel, pageUrl);
    return u.hostname === "learn.microsoft.com" && u.pathname.endsWith(".json") ? `${u.origin}${u.pathname}` : undefined;
  } catch {
    return undefined;
  }
}
