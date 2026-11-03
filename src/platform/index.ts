import type { Platform } from "./types";
import { webPlatform } from "./web";

export type { AutosaveStore, FileSaver, OpenedFile, Platform, RecentAssessment, SaveResult } from "./types";

/** True in the Tauri build (`vite build --mode desktop`). A compile-time constant, so the web build drops desktop code. */
export const isDesktop = import.meta.env.MODE === "desktop";

/**
 * The platform this build runs on. The web build uses the browser from the first line; the desktop build swaps in
 * the native implementation once `platformReady` resolves, and main.tsx holds rendering and hydration until then.
 */
export let platform: Platform = webPlatform;

export const platformReady: Promise<void> = isDesktop
  ? import("./tauri").then(async ({ createTauriPlatform }) => {
      platform = await createTauriPlatform();
    })
  : Promise.resolve();
