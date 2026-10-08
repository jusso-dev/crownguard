/**
 * Trigger a browser download without leaving the page. The anchor is attached to the document (some browsers
 * ignore clicks on detached anchors) and JSON is sent as octet-stream so no browser opens it in the tab instead.
 */
export function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assessment";

interface WritableFile {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  name: string;
}
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<WritableFile>;

export type SaveResult = { kind: "saved"; file: string; reused: boolean } | { kind: "downloaded"; file: string } | { kind: "cancelled" };

/**
 * Saves the assessment as a file while keeping the user on the current screen.
 * Where the browser supports it, the first save asks for a location and later saves overwrite that same file
 * silently, like a document's Save. Elsewhere it falls back to a download.
 */
export function createFileSaver() {
  let handle: WritableFile | null = null;

  return {
    reset() {
      handle = null;
    },
    get fileName() {
      return handle?.name;
    },
    async save(suggestedName: string, contents: string): Promise<SaveResult> {
      const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      if (!picker) {
        download(suggestedName, contents, "application/octet-stream");
        return { kind: "downloaded", file: suggestedName };
      }
      const reused = handle !== null;
      try {
        handle ??= await picker({
          suggestedName,
          types: [{ description: "crownguard assessment", accept: { "application/json": [".json"] } }],
        });
        const w = await handle.createWritable();
        await w.write(contents);
        await w.close();
        return { kind: "saved", file: handle.name, reused };
      } catch (e) {
        if ((e as Error).name === "AbortError") return { kind: "cancelled" };
        // Permission revoked or file moved: forget it and fall back to a plain download.
        handle = null;
        download(suggestedName, contents, "application/octet-stream");
        return { kind: "downloaded", file: suggestedName };
      }
    },
  };
}

/** Ask the app shell to open its "Open file" picker (it owns the hidden file input). */
export const OPEN_FILE_EVENT = "crownguard:open-file";
export const requestOpenFile = () => window.dispatchEvent(new Event(OPEN_FILE_EVENT));
