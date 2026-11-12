// Finds the Storydiff spec(s) a PR carries.
//
// `storydiff publish` writes the PR description like this (one block per chapter):
//
//   <!-- storydiff:start -->
//   ```storydiff
//   title "…"
//   …
//   ```
//   <!-- storydiff-report {"oldPass":3,…} -->
//   <!-- storydiff:end -->
//
// The report comment is optional, and a bare ```storydiff block without the markers counts too,
// so a person can paste a spec by hand.

export const START = '<!-- storydiff:start -->';
export const END = '<!-- storydiff:end -->';

const FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*storydiff[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
const REPORT = /<!--\s*storydiff-report\s*([\s\S]*?)\s*-->/;

/** @returns {{ spec: string, report: object | null }[]} in the order they appear */
export function extractSpecs(body) {
  if (!body) return [];
  let text = String(body).replace(/\r\n?/g, '\n');
  const s = text.indexOf(START), e = s >= 0 ? text.indexOf(END, s) : -1;
  if (s >= 0 && e > s) text = text.slice(s + START.length, e);

  const blocks = [];
  for (const m of text.matchAll(FENCE)) blocks.push({ spec: m[3].replace(/\s+$/, '') + '\n', at: m.index, end: m.index + m[0].length });
  return blocks.map((b, i) => {
    const tail = text.slice(b.end, i + 1 < blocks.length ? blocks[i + 1].at : text.length);
    const r = tail.match(REPORT);
    let report = null;
    if (r) { try { report = JSON.parse(r[1]); } catch { report = null; } }
    return { spec: b.spec, report };
  });
}

/** The chapter number a spec declares (`chapter 2`), or null. */
export function chapterOf(spec) {
  const m = String(spec).match(/^[ \t]*chapter[ \t]+(\d+)/m);
  return m ? +m[1] : null;
}

/** True when the spec has a slot-3 picture to capture. */
export function hasShows(spec) {
  return /^[ \t]*show[ \t]/m.test(String(spec));
}
