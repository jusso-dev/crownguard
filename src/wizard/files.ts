/** A file name from free text, e.g. an organisation's name. */
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assessment";

const p2 = (n: number) => String(n).padStart(2, "0");
/** Local date for a file name, e.g. 2026-11-07, with the time as well (2026-11-07-1405) when `withTime`. */
const fileDate = (d: Date, withTime = false) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}${withTime ? `-${p2(d.getHours())}${p2(d.getMinutes())}` : ""}`;

/** The names crownguard gives the files it writes. */
export const fileNames = {
  assessment: (org: string, standalone: boolean) => `${slug(org)}${standalone ? "-ai-register" : ""}.crownguard.json`,
  report: (org: string, standalone: boolean, at: Date) => (standalone ? `${slug(org)}-ai-register.pdf` : `${slug(org)}-crown-jewel-risk-${fileDate(at, true)}.pdf`),
  register: (org: string, ext: "csv" | "xlsx", at: Date) => `${slug(org)}-ai-use-case-register-${fileDate(at)}.${ext}`,
};

/**
 * Ask the app shell to open its "Open file" picker: the shell owns the picker (the hidden file input on the web) and
 * what happens to the file it opens. `defaultPath` starts the desktop open dialog at a recent file.
 */
export const OPEN_FILE_EVENT = "crownguard:open-file";
export const requestOpenFile = (defaultPath?: string) =>
  window.dispatchEvent(new CustomEvent<{ defaultPath?: string }>(OPEN_FILE_EVENT, { detail: { defaultPath } }));
