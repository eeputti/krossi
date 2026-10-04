// geo.js — distances and the (opt-in) browser location.
import { CITY_CENTERS } from './constants.js';

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** '2,4 km' / '12 km' */
export function formatDistance(km) {
  if (km == null) return '';
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function cityCenter(city) {
  return CITY_CENTERS[city] || CITY_CENTERS.Lahti;
}

/** Adds `distanceKm` to every game that has coordinates, measured from `origin` ([lat, lng]). */
export function withDistance(games, origin) {
  return games.map((g) => ({
    ...g,
    distanceKm: origin && g.lat != null && g.lng != null ? haversineKm(origin[0], origin[1], g.lat, g.lng) : null,
  }));
}

let cached = null;
/**
 * requestPosition() — asks the browser for the user's location once per page load.
 * Resolves to [lat, lng] or null (denied / unsupported / timeout). Never rejects.
 */
export function requestPosition() {
  if (cached) return cached;
  cached = new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => { cached = null; resolve(null); },
      { timeout: 8000, maximumAge: 10 * 60_000 },
    );
  });
  return cached;
}
