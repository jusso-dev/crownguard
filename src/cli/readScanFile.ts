import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { assertImportBytes, importLimits } from "../imports/limits";

/** Scan sources only. One descriptor prevents pathname swaps; the sentinel bounds growth after stat. */
export function readScanFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("scan input must be a regular file");
    assertImportBytes(stat.size);
    const buffer = Buffer.alloc(importLimits.maxBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(fd, buffer, { offset: bytes, length: buffer.length - bytes, position: null });
      if (read === 0) break;
      bytes += read;
    }
    assertImportBytes(bytes);
    const text = buffer.toString("utf8", 0, bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } finally {
    closeSync(fd);
  }
}
