// maplibre.js — loads MapLibre GL JS from the CDN the first time a map is shown.
// Nothing map-related is in the app bundle; the script + stylesheet arrive on demand.

const VERSION = '5.24.0';
const BASE = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist`;
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TIMEOUT_MS = 15_000;

let pending = null;

/** Resolves to window.maplibregl. Rejects (and allows a retry) when the CDN is unreachable. */
export function loadMapLibre() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-maplibre]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${BASE}/maplibre-gl.css`;
      link.dataset.maplibre = '1';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = `${BASE}/maplibre-gl.js`;
    script.async = true;
    const fail = (why) => {
      clearTimeout(timer);
      script.remove();
      pending = null;
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('MapLibre load timed out'), TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      if (window.maplibregl) resolve(window.maplibregl);
      else fail('MapLibre missing after load');
    };
    script.onerror = () => fail('MapLibre script failed to load');
    document.head.appendChild(script);
  });
  return pending;
}
