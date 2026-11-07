
export const firstSentence = (t: string) => t.split(/(?<=\.)\s/)[0];

export const sentence = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);


/** Full timestamp with time zone, e.g. "8 October 2026 at 5:42 pm AEDT". */
export const stampText = (d: Date) =>
  d.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
