import { platform } from "../platform";

export type { SaveAsResult, SaveResult } from "../platform";

/**
 * Save a generated file without leaving the page: a browser download on the web, a native save dialog on desktop
 * (see src/platform/).
 */
export function download(filename: string, data: BlobPart, type: string) {
  return platform.saveAs(filename, data, type);
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assessment";

/**
 * Saves the assessment as a file while keeping the user on the current screen. The first save asks for a location
 * and later saves overwrite that same file, like a document's Save, wherever the platform allows it.
 */
export const createFileSaver = () => platform.createFileSaver();

/** Ask the app shell to open its "Open file" picker (it owns the hidden file input on the web). */
export const OPEN_FILE_EVENT = "crownguard:open-file";
/** `defaultPath` starts the desktop open dialog at a recent file; the web file input ignores it. */
export const requestOpenFile = (defaultPath?: string) =>
  window.dispatchEvent(new CustomEvent<{ defaultPath?: string }>(OPEN_FILE_EVENT, { detail: { defaultPath } }));
