/** A file name from free text, e.g. an organisation's name. */
export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assessment";

/**
 * Ask the app shell to open its "Open file" picker: the shell owns the picker (the hidden file input on the web) and
 * what happens to the file it opens. `defaultPath` starts the desktop open dialog at a recent file.
 */
export const OPEN_FILE_EVENT = "crownguard:open-file";
export const requestOpenFile = (defaultPath?: string) =>
  window.dispatchEvent(new CustomEvent<{ defaultPath?: string }>(OPEN_FILE_EVENT, { detail: { defaultPath } }));
