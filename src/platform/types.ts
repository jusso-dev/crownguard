/**
 * What the wizard needs from wherever it runs. The web build keeps today's browser behaviour (`web.ts`); the desktop
 * build swaps in native dialogs, files and SQLite (`tauri.ts`). Nothing outside `src/platform/` knows which it got.
 */

/**
 * Every key the app writes to the autosave store. The desktop backend accepts only these (AUTOSAVE_KEYS in
 * src-tauri/src/commands.rs; autosaveKeys.test.ts checks the two lists match).
 */
export const autosaveKeys = {
  /** The assessment in progress. */
  progress: "crownguard:v1",
  /** Where a stored assessment is moved when it can't be read, so the user can still download it. */
  unreadable: "crownguard:v1:unreadable",
  /** EPHEMERAL_ON while the user has asked for nothing about the assessment to be kept on this device. */
  ephemeral: "crownguard:v1:ephemeral",
  /** Written and removed straight away to find out whether the store accepts writes. */
  probe: "crownguard:v1:probe",
} as const;
/** The value of `autosaveKeys.ephemeral` while that mode is on. */
export const EPHEMERAL_ON = "1";

/** Synchronous key/value storage for autosave. The shape of `localStorage`, so the web build can pass it straight in. */
export interface AutosaveStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A file the user opened. `path` is set on desktop, where the app can save back to the same file. */
export interface OpenedFile {
  name: string;
  text: string;
  path?: string;
}

/** What happened to a generated file: downloaded (web), saved where the user chose, or not saved. */
export type SaveAsResult = "downloaded" | "saved" | "cancelled" | "failed";

export type SaveResult =
  | { kind: "saved"; file: string; reused: boolean }
  | { kind: "downloaded"; file: string }
  | { kind: "cancelled" }
  | { kind: "failed"; file: string; error: string };

/** Save (⌘/Ctrl S) for `.crownguard.json`: the first save asks where, later saves go back to the same file. */
export interface FileSaver {
  reset(): void;
  readonly fileName: string | undefined;
  save(suggestedName: string, contents: string): Promise<SaveResult>;
  /** Treat a file that was just opened as the one to save back to. Only desktop knows a file's path. */
  adopt(file: OpenedFile): void;
}

/** One row of the local assessments index (desktop only; the web build keeps a single assessment). */
export interface RecentAssessment {
  id: string;
  /** Absent for encrypted assessments: the index never holds their plaintext. */
  orgName?: string | null;
  platforms: string[];
  mode?: string | null;
  encrypted: boolean;
  filePath?: string | null;
  updatedAt: string;
}

export interface Platform {
  readonly kind: "web" | "desktop";
  /** Where autosave lives: localStorage on the web (undefined when the browser refuses it), SQLite on desktop. */
  autosave(): AutosaveStore | undefined;
  /**
   * Ask the user for a `.crownguard.json` file. Undefined means "use the page's own file input" (web), so the
   * browser's file picker keeps working exactly as before.
   */
  openFile(options?: { defaultPath?: string }): Promise<OpenedFile | null> | undefined;
  createFileSaver(): FileSaver;
  /** Save a generated file (PDF, XLSX, CSV, a backup): a download on the web, a native save dialog on desktop. */
  saveAs(filename: string, data: BlobPart, type: string): Promise<SaveAsResult>;
  /** Why the last autosave write failed, if it did (desktop only: browser storage failures fall back to memory). */
  autosaveError(): string | undefined;
  /** Assessments opened or saved on this device, newest first. */
  listRecent(): Promise<RecentAssessment[]>;
  /** Files the operating system asks the app to open (double-click, Open With). Returns an unsubscribe. */
  onOpenRequest(handler: (file: OpenedFile) => void): () => void;
}
