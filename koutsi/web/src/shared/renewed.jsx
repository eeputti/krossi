// renewed.jsx — the "[BETA] Koutsilla uusi ilme! Palaa vanhaan" bar's switch. The one-time
// "Krossi Koutsin ilme on uudistunut" note that used to live here was removed 11.11.2026 at the
// user's request (everyone has had the new look since 25.10.).
import { isDemo } from '../api/index.js';

// `npm run dev:koutsi` → /demo/valmentaja?esikatsele shows the beta bar in the demo, so it can be
// checked without signing in. Production builds drop this branch.
export const previewRenewed = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('esikatsele');

/** Show the "Koutsilla uusi ilme!" bar: in the real apps, or when previewing in dev. A
 *  function, not a constant: isDemo is set when the entry installs its backend, after the
 *  modules have loaded. */
export function showBetaBar() {
  return !isDemo || previewRenewed;
}
