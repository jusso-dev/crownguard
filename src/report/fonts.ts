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
  Font.registerHyphenationCallback(breakLongWords);
}

const LONG_WORD = 24;
const WORD_PIECE = 8;

/**
 * No hyphenation of ordinary words, but long unbroken tokens (URLs, paths, a pasted ID) get break points every few
 * characters: without them a token wider than its line or table cell runs off the page and the rest is lost.
 * Splits by code point so a surrogate pair (emoji, rare CJK) is never cut in half.
 */
export function breakLongWords(word: string): string[] {
  const chars = Array.from(word);
  if (chars.length <= LONG_WORD) return [word];
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += WORD_PIECE) pieces.push(chars.slice(i, i + WORD_PIECE).join(""));
  return pieces;
}

let diskRegistered = false;

/** Idempotent Node registration from the on-disk TTFs. Safe to call before every render. */
export function registerFontsFromDisk(dir?: string) {
  if (diskRegistered) return;
  registerFonts(fontFilesOnDisk(dir));
  diskRegistered = true;
}
