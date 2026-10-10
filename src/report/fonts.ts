import { Font } from "@react-pdf/renderer";
import { join } from "node:path";

export interface FontFiles {
  regular: string;
  italic: string;
  semibold: string;
  bold: string;
}

/** Absolute paths to the Inter TTFs shipped beside this module. Browser still passes asset URLs into `registerFonts`. */
export function fontFilesOnDisk(dir = join(import.meta.dirname, "fonts")): FontFiles {
  return {
    regular: join(dir, "Inter_400Regular.ttf"),
    italic: join(dir, "Inter_400Regular_Italic.ttf"),
    semibold: join(dir, "Inter_600SemiBold.ttf"),
    bold: join(dir, "Inter_700Bold.ttf"),
  };
}

/** Registers the report font. Browser passes asset URLs; Node and tests pass file paths (see `fontFilesOnDisk`). */
export function registerFonts(f: FontFiles) {
  Font.register({
    family: "Inter",
    fonts: [
      { src: f.regular, fontWeight: 400 },
      { src: f.italic, fontWeight: 400, fontStyle: "italic" },
      { src: f.semibold, fontWeight: 600 },
      { src: f.bold, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

let diskRegistered = false;

/** Idempotent Node registration from the on-disk TTFs. Safe to call before every render. */
export function registerFontsFromDisk(dir?: string) {
  if (diskRegistered) return;
  registerFonts(fontFilesOnDisk(dir));
  diskRegistered = true;
}
