// usage-words.mjs — the UI vocabulary that lib/koutsi-usage.js lets through as tap labels.
//
// Every word that appears in a string literal or JSX text of the given app sources,
// lowercased. Comments are dropped first (esbuild minify), and so are placeholder texts and
// a few names that occur in the sources, so example names ("esim. …") can't make a real
// person's name look like the app's own wording. The tracker sends a tap's text only when
// every word of it is in this list; a player's or group's name never is.
//
// Used by build.mjs (old Koutsi) and koutsi/web/build.mjs (renewed Koutsi).

import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

// Names found in the app sources (contact person, owner) and the one common Finnish first
// name that is also a UI verb ("Anna palautetta").
const NOT_UI_WORDS = new Set(['eelis', 'puro', 'alpo', 'anna']);

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const PLACEHOLDER = /placeholder:("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

/** Space-separated, sorted vocabulary of the given source files. */
export async function usageWords(files) {
  const words = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    // charset utf8 keeps ä and ö as letters (esbuild escapes them by default); no tree shaking,
    // so a string counts even where the minifier could prove it unused
    const { code } = await transform(source, {
      loader: 'jsx', jsx: 'transform', minify: true, legalComments: 'none', charset: 'utf8', treeShaking: false,
    });
    for (const literal of code.replace(PLACEHOLDER, '').match(STRING) || []) {
      for (const word of literal.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/g) || []) {
        const lower = word.toLowerCase();
        if (!NOT_UI_WORDS.has(lower)) words.add(lower);
      }
    }
  }
  return [...words].sort().join(' ');
}
