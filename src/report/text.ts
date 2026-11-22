
export const firstSentence = (t: string) => t.split(/(?<=\.)\s/)[0];

export const sentence = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);


