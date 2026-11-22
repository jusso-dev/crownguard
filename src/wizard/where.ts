import { isDesktop } from "../platform";

/** Where autosaved progress lives, in the words the screens use: "this device" on desktop, "this browser" on the web. */
export const THIS = isDesktop ? "this device" : "this browser";
/** "in this browser" or "on this device". */
export const HERE = isDesktop ? `on ${THIS}` : `in ${THIS}`;
